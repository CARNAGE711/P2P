/**
 * PeerNetwork — the WebRTC engine behind BeamDrop.
 * ---------------------------------------------------------------------------
 * Responsibilities:
 *   1. Connect to the Socket.io signaling server and join a room.
 *   2. Maintain one RTCPeerConnection per remote peer (full mesh) and drive
 *      the handshake using the "perfect negotiation" pattern so glare
 *      (simultaneous offers) is handled correctly, even mid-transfer.
 *   3. Open one reliable, ordered RTCDataChannel per peer and multiplex any
 *      number of concurrent file transfers over it.
 *   4. Chunk files with FileReader, stream them with back-pressure
 *      (bufferedAmountLowThreshold), and reassemble them into a Blob on the
 *      receiving side, triggering an automatic download.
 *
 * Wire protocol over the data channel:
 *   JSON control messages  →  { t: 'meta' | 'done' | 'abort', id, ... }
 *   binary frames          →  [ 4-byte transfer id (Uint32 BE) ][ chunk bytes ]
 *   The 4-byte prefix lets multiple transfers share a channel without
 *   interleaving their payloads.
 *
 * The class never touches React directly: it pushes immutable snapshots of
 * its state through `onState(snapshot)` and toasts through `onToast(t)`.
 * ---------------------------------------------------------------------------
 */

import { io } from 'socket.io-client';

/* ─── Tuning constants ────────────────────────────────────────────────────── */

// Public STUN server so peers behind NATs can discover their public address.
export const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302'] }];

const CHUNK_SIZE = 64 * 1024; // default slice size when the negotiated
// maxMessageSize is unknown; the pump adapts upward (Chrome↔Chrome negotiates
// 256 KB messages) or downward (min 16 KB) per connection.
const MAX_CHUNK = 256 * 1024; // hard cap per data-channel message
const CHUNK_SIZE_MIN = 16 * 1024; // floor — below this message overhead wins
const BUFFER_HIGH_WATER = 4 * 1024 * 1024; // pause sending above 4 MB buffered
const BUFFER_LOW_WATER = 1 * 1024 * 1024; // resume below 1 MB buffered
const EMIT_INTERVAL = 150; // throttle progress updates (ms)
const SPEED_SAMPLE_MS = 200; // window for instantaneous speed samples
const STALL_TIMEOUT = 2000; // no bytes for 2 s → speed shows 0

/* TCP relay fallback: some networks throttle WebRTC's UDP path hard while
 * TCP flows at full speed. When a direct transfer samples below the
 * threshold, the remaining chunks switch to the relay transport (the same
 * framed protocol, carried over the Socket.io websocket). */
const RELAY_CHUNK_SIZE = 256 * 1024; // per-relay-message payload
const RELAY_WINDOW_CHUNKS = 24; // max unacked chunks in flight (~6 MB)
const RELAY_SWITCH_SPEED = 2 * 1024 * 1024; // < 2 MB/s → engage relay
const RELAY_MIN_SENT = 2 * 1024 * 1024; // sample at least 2 MB directly first
const RELAY_MIN_REMAIN = 16 * 1024 * 1024; // only worth it for big remainders

/* ─── Small helpers ───────────────────────────────────────────────────────── */

/**
 * Read a Blob slice into an ArrayBuffer using the FileReader API.
 * (FileReader is used instead of blob.arrayBuffer() because it streams
 * efficiently and is the classic, widely-supported approach.)
 */
function readFileAsArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsArrayBuffer(blob);
  });
}

/** Average transfer speed over the whole lifetime of a transfer. */
function averageSpeed(t) {
  const elapsed = (performance.now() - t.startedAt) / 1000;
  const bytes = t.direction === 'send' ? t.sent : t.received;
  return elapsed > 0 ? bytes / elapsed : 0;
}

/** Infer a coarse device class from the user agent. */
export function detectDevice() {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'phone';
  return 'desktop';
}

/* ─── The engine ──────────────────────────────────────────────────────────── */

export default class PeerNetwork {
  /**
   * @param {object}   options
   * @param {string}   options.serverUrl  Base URL of the signaling server ('/' in dev).
   * @param {Function} options.onState    Called with a full state snapshot on change.
   * @param {Function} [options.onToast]  Called with transient notification payloads.
   */
  constructor({ serverUrl = '/', onState, onToast } = {}) {
    this.serverUrl = serverUrl;
    this.onState = onState;
    this.onToast = onToast;

    this._socket = null;
    this._myId = null;
    this._name = '';
    this._room = '';
    this._device = 'desktop';
    this._started = false;

    /** remote socketId → peer record (pc, dc, negotiation flags, …) */
    this.peers = new Map();
    /** internalKey → transfer record (both directions) */
    this.transfers = new Map();
    this._seq = 0; // internal unique transfer key counter

    this._emitTimer = null;
    this._tickTimer = setInterval(() => this._tick(), 1000);
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  /** Connect to the signaling server and join a room. */
  join({ name, room }) {
    this._name = name;
    this._room = room;
    this._device = detectDevice();

    const socket = io(this.serverUrl, {
      transports: ['websocket'],
      reconnection: true,
    });
    this._socket = socket;

    socket.on('connect', () => {
      const reconnected = this._started;
      this._myId = socket.id;
      // After a reconnect our socket id (and therefore the mesh) is stale.
      if (reconnected) {
        this.peers.forEach((peer) => {
          try {
            peer.pc?.close();
          } catch {
            /* already closed */
          }
        });
        this.peers.clear();
      }
      socket.emit('join', { room: this._room, name: this._name, device: this._device }, (res) => {
        if (res?.error) this.onToast?.({ kind: 'error', fileName: res.error });
      });
      this._started = true;
      this._emit();
    });

    socket.on('disconnect', () => this._emit());

    // Server confirms our join and hands us the current roster.
    socket.on('joined', ({ peers }) => {
      peers.forEach((p) => {
        this._addPeer(p);
        this._maybeInitiate(p.id);
      });
      this._emit();
    });

    // An existing peer learns about a newcomer.
    socket.on('peer-joined', ({ peer }) => {
      this._addPeer(peer);
      this._maybeInitiate(peer.id);
      this._emit();
    });

    socket.on('peer-left', ({ id }) => {
      this._removePeer(id);
      this._emit();
    });

    // SDP offers / answers and ICE candidates, relayed by the server.
    socket.on('signal', ({ from, payload }) => {
      this._handleSignal(from, payload).catch((err) =>
        console.warn('[signal] handler error:', err),
      );
    });

    // TCP relay transport: framed chunks (or JSON control frames) forwarded
    // by the server, handled by the exact same pipeline as DataChannel data.
    socket.on('relay-chunk', ({ from, frame } = {}) => {
      try {
        if (typeof frame === 'string') this._handleControl(from, JSON.parse(frame));
        else if (frame instanceof ArrayBuffer) this._handleChunk(from, frame);
      } catch {
        /* ignore malformed relay frames */
      }
    });

    // Receiver-side flow-control credits for the relay transport.
    socket.on('relay-ack', ({ from, id, count } = {}) => {
      for (const t of this.transfers.values()) {
        if (t.direction === 'send' && t.transport === 'relay' && t.remoteId === id && t.peerId === from) {
          if (count > t.relayAckedChunks) {
            t.relayAckedChunks = count;
            t.lastRelayAckAt = performance.now();
            this._flushWaiters(t);
          }
          return;
        }
      }
    });
  }

  /**
   * Send a file to a peer. Returns the internal transfer key, or throws if
   * the data channel is not open yet.
   *
   * @param {object} [opts] `{ transport: 'relay' }` forces the TCP relay
   *   transport for this transfer (otherwise it starts on the direct
   *   DataChannel and may auto-switch to relay when the link is slow).
   */
  sendFile(peerId, file, opts = {}) {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error('Peer not found');
    const useRelay = opts.transport === 'relay' && !!this._socket?.connected;
    if (!useRelay && (!peer.dc || peer.dc.readyState !== 'open')) {
      throw new Error('Peer is not connected yet');
    }

    // Transfer ids are scoped to one channel (4-byte prefix on every chunk),
    // while `key` is globally unique inside this client.
    const remoteId = ++peer.outgoingSeq;
    const key = `t${++this._seq}`;

    const transfer = {
      key,
      remoteId,
      peerId,
      direction: 'send',
      name: file.name,
      size: file.size,
      mime: file.type || '',
      sent: 0,
      received: 0,
      status: 'transferring',
      speed: 0,
      startedAt: performance.now(),
      lastSample: { time: performance.now(), bytes: 0 },
      fileRef: file, // kept in the closure, never copied into memory
      parts: null,
      url: null,
      error: null,
      /** 'dc' | 'switching' | 'relay' — which transport carries the chunks */
      transport: useRelay ? 'relay' : 'dc',
      relaySentChunks: 0,
      relayAckedChunks: 0,
      waiters: [], // relay flow-control resolvers (internal)
    };
    this.transfers.set(key, transfer);

    // 1) announce the file, 2) start the chunk pump.
    const meta = JSON.stringify({
      t: 'meta', id: remoteId, name: file.name, size: file.size, mime: file.type,
    });
    if (useRelay) {
      this._socket.emit('relay-chunk', { to: peerId, frame: meta });
      // Put the receiver in ACK mode immediately (same ordering guarantee as
      // the chunks that follow: per-socket, in-order delivery).
      this._socket.emit('relay-chunk', {
        to: peerId,
        frame: JSON.stringify({ t: 'relay-on', id: remoteId }),
      });
      this._pumpRelay(peerId, key);
    } else {
      peer.dc.send(meta);
      this._pump(peerId, key);
    }
    this._emit();
    return key;
  }

  /** Cancel an active transfer (works for both directions). */
  cancelTransfer(key) {
    const t = this.transfers.get(key);
    if (!t) return;
    if (t.status !== 'transferring' && t.status !== 'receiving') return;

    const peer = this.peers.get(t.peerId);
    // Tell the other side to stop as well — over whichever transport the
    // transfer is currently using. The receiver simply discards chunks for
    // unknown/aborted ids, which keeps its buffers draining.
    if (t.transport === 'relay' && this._socket?.connected) {
      this._socket.emit('relay-chunk', {
        to: t.peerId,
        frame: JSON.stringify({ t: 'abort', id: t.remoteId }),
      });
    } else if (peer?.dc?.readyState === 'open') {
      peer.dc.send(JSON.stringify({ t: 'abort', id: t.remoteId }));
    }

    t.status = 'aborted';
    t.speed = 0;
    t.parts = null;
    peer?.incoming.delete(t.remoteId);
    this._emit();
  }

  /** Remove a finished/failed transfer card from the UI. */
  dismissTransfer(key) {
    const t = this.transfers.get(key);
    if (!t) return;
    if (['transferring', 'receiving'].includes(t.status)) return;
    if (t.url) URL.revokeObjectURL(t.url);
    this.transfers.delete(key);
    this._emit();
  }

  /** Tear everything down (socket, peer connections, timers). */
  destroy() {
    clearInterval(this._tickTimer);
    if (this._emitTimer) clearTimeout(this._emitTimer);
    this.peers.forEach((peer) => {
      try {
        peer.pc?.close();
      } catch {
        /* ignore */
      }
    });
    this.peers.clear();
    this.transfers.clear();
    this._socket?.disconnect();
    this._socket = null;
  }

  /* ── Peer connection management ────────────────────────────────────────── */

  /** Register (or refresh) a peer discovered via signaling. */
  _addPeer(info) {
    if (this.peers.has(info.id)) {
      Object.assign(this.peers.get(info.id), info);
      return;
    }
    this.peers.set(info.id, {
      id: info.id,
      name: info.name || 'Unnamed device',
      device: info.device || 'desktop',
      pc: null,
      dc: null,
      /** recv transfer id (from wire) → internal transfer key */
      incoming: new Map(),
      /** send transfer id counter, scoped to this channel */
      outgoingSeq: 0,
      // -- perfect negotiation flags --
      polite: false,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
    });
  }

  /** Close a peer and fail any transfers that were running with it. */
  _removePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    try {
      peer.pc?.close();
    } catch {
      /* ignore */
    }
    this.peers.delete(id);
    for (const t of this.transfers.values()) {
      if (t.peerId === id && ['transferring', 'receiving'].includes(t.status)) {
        t.status = 'failed';
        t.error = 'Peer disconnected';
        t.parts = null;
        t.speed = 0;
      }
    }
  }

  /**
   * Deterministic initiator rule: the peer with the lexicographically smaller
   * socket id creates the RTCPeerConnection + DataChannel and sends the offer.
   * The other side waits and answers. No glare on the initial handshake, and
   * perfect negotiation below covers later renegotiations.
   */
  _maybeInitiate(peerId) {
    if (this._myId >= peerId) return;
    const peer = this.peers.get(peerId);
    if (!peer || peer.pc) return;

    this._createPeerConnection(peerId);
    const dc = peer.pc.createDataChannel('file-transfer', { ordered: true });
    this._wireDataChannel(peerId, dc);
    this._negotiate(peer);
  }

  _createPeerConnection(peerId) {
    const peer = this.peers.get(peerId);
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 4,
    });
    peer.pc = pc;
    peer.polite = this._myId > peerId; // impolite side = initiator

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this._signal(peerId, { candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') this._inspectPath(peerId);
      this._emitThrottled();
    };
    // The answerer receives the channel created by the initiator.
    pc.ondatachannel = ({ channel }) => this._wireDataChannel(peerId, channel);
    return pc;
  }

  /** Run one negotiation round: setLocalDescription → send our SDP. */
  async _negotiate(peer) {
    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription();
      this._signal(peer.id, { sdp: peer.pc.localDescription });
    } finally {
      peer.makingOffer = false;
    }
  }

  /** Perfect negotiation signal handler (offers, answers, ICE). */
  async _handleSignal(from, payload) {
    const peer = this.peers.get(from);
    if (!peer) return;

    if (payload.sdp) {
      // Lazily create our side of the connection when an offer arrives.
      if (!peer.pc) this._createPeerConnection(from);

      const description = new RTCSessionDescription(payload.sdp);
      const readyForOffer =
        !peer.makingOffer &&
        (peer.pc.signalingState === 'stable' || peer.isSettingRemoteAnswerPending);
      const offerCollision = description.type === 'offer' && !readyForOffer;

      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return; // impolite peer wins the collision

      peer.isSettingRemoteAnswerPending = description.type === 'answer';
      try {
        await peer.pc.setRemoteDescription(description);
      } finally {
        peer.isSettingRemoteAnswerPending = false;
      }
      if (description.type === 'offer') {
        await peer.pc.setLocalDescription();
        this._signal(from, { sdp: peer.pc.localDescription });
      }
      this._emitThrottled();
    } else if (payload.candidate) {
      try {
        await peer.pc?.addIceCandidate(payload.candidate);
      } catch (err) {
        if (!peer.ignoreOffer) console.warn('[ice] candidate error:', err);
      }
    }
  }

  /* ── Data channel wiring ───────────────────────────────────────────────── */

  _wireDataChannel(peerId, dc) {
    const peer = this.peers.get(peerId);
    peer.dc = dc;
    dc.binaryType = 'arraybuffer';
    // Back-pressure: the sender pauses once bufferedAmount exceeds the high
    // water mark and resumes when it drains below the low water threshold.
    dc.bufferedAmountLowThreshold = BUFFER_LOW_WATER;

    dc.onopen = () => this._emit();
    dc.onclose = () => this._emit();
    dc.onerror = () => {};
    dc.onmessage = (event) => this._onChannelData(peerId, event.data);
  }

  /** Demultiplex raw channel data into control messages vs. binary chunks. */
  _onChannelData(peerId, data) {
    if (data instanceof ArrayBuffer) {
      this._handleChunk(peerId, data);
      return;
    }
    if (typeof data === 'string') {
      try {
        this._handleControl(peerId, JSON.parse(data));
      } catch {
        /* ignore malformed control frames */
      }
    }
  }

  /* ── Incoming (receiving) pipeline ─────────────────────────────────────── */

  _handleControl(peerId, msg) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    switch (msg.t) {
      case 'meta': {
        if (peer.incoming.has(msg.id)) return; // duplicate frame, ignore
        const key = `t${++this._seq}`;
        const record = {
          key,
          remoteId: msg.id,
          peerId,
          direction: 'recv',
          name: msg.name || 'file',
          size: msg.size || 0,
          mime: msg.mime || '',
          sent: 0,
          received: 0,
          status: 'receiving',
          speed: 0,
          startedAt: performance.now(),
          lastSample: { time: performance.now(), bytes: 0 },
          /** accumulated ArrayBuffers, freed once assembled into a Blob */
          parts: [],
          url: null,
          error: null,
          /** updated to 'relay' when a relay-on control frame arrives */
          transport: 'dc',
          relayRecvCount: 0,
        };
        this.transfers.set(key, record);
        peer.incoming.set(msg.id, key);
        this.onToast?.({ kind: 'incoming', peerName: peer.name, fileName: record.name });
        this._emit();
        if (record.size === 0) this._finishIncoming(peer, record); // empty file
        break;
      }

      case 'done': {
        const key = peer.incoming.get(msg.id);
        const t = key ? this.transfers.get(key) : null;
        if (t && t.status === 'receiving') this._finishIncoming(peer, t);
        break;
      }

      case 'relay-on': {
        // The sender switched this transfer to the TCP relay transport —
        // from now on every received chunk must be ACKed for back-pressure.
        const key = peer.incoming.get(msg.id);
        const t = key ? this.transfers.get(key) : null;
        if (t && t.status === 'receiving') t.transport = 'relay';
        break;
      }

      case 'abort': {
        // The other side cancelled — fail the matching transfer on our side.
        for (const t of this.transfers.values()) {
          if (
            t.peerId === peerId &&
            t.remoteId === msg.id &&
            ['transferring', 'receiving'].includes(t.status)
          ) {
            t.status = 'aborted';
            t.speed = 0;
            t.parts = null;
            peer.incoming.delete(t.remoteId);
          }
        }
        this._emit();
        break;
      }
    }
  }

  /** Handle one framed binary chunk: [4-byte id][payload]. */
  _handleChunk(peerId, buffer) {
    const peer = this.peers.get(peerId);
    if (!peer || buffer.byteLength < 4) return;

    const remoteId = new DataView(buffer).getUint32(0);
    const key = peer.incoming.get(remoteId);
    const t = key ? this.transfers.get(key) : null;
    // Chunks for unknown / aborted transfers are discarded (this also keeps
    // the channel draining after a cancel, preventing sender deadlock).
    if (!t || t.status !== 'receiving') return;

    const payload = buffer.slice(4);
    t.parts.push(payload);
    t.received += payload.byteLength;
    this._sampleSpeed(t);

    // Credit back-pressure when this transfer rides the relay transport:
    // one tiny ACK per chunk lets the sender's window advance.
    if (t.transport === 'relay') {
      t.relayRecvCount = (t.relayRecvCount || 0) + 1;
      this._socket?.emit('relay-ack', { to: peerId, id: remoteId, count: t.relayRecvCount });
    }
    this._emitThrottled();
  }

  /** Assemble received chunks into a Blob and show it in the in-app viewer. */
  _finishIncoming(peer, t) {
    const blob = new Blob(t.parts, { type: t.mime || 'application/octet-stream' });
    t.parts = null; // free the chunk memory
    t.url = URL.createObjectURL(blob);
    t.received = t.size;
    t.status = 'done';
    t.speed = averageSpeed(t);
    peer.incoming.delete(t.remoteId);
    // No auto-download: the UI opens the in-browser viewer for this transfer
    // (key lets the hook find the record and display it; saving is manual).
    this.onToast?.({ kind: 'received', key: t.key, peerName: peer.name, fileName: t.name });
    this._emit();
  }

  /* ── Outgoing (sending) pipeline ───────────────────────────────────────── */

  /**
   * Sequential chunk pump. Reads file slices via FileReader (chunk size
   * adapts to the negotiated DataChannel message limit), frames them
   * with the transfer id, and respects the data channel's buffer high-water
   * mark to keep memory usage flat regardless of file size.
   */
  async _pump(peerId, key) {
    const peer = this.peers.get(peerId);
    const t = this.transfers.get(key);
    if (!peer || !t) return;
    const dc = peer.dc;
    let offset = t.sent;

    // Pick the largest safe chunk size for THIS connection: the SCTP stack
    // negotiates a maxMessageSize (256 KB on Chrome↔Chrome links); fall back
    // to the 64 KB universal default when the browser doesn't report one.
    const negotiated = dc.maxMessageSize > 0 ? dc.maxMessageSize : CHUNK_SIZE;
    const chunkSize = Math.min(MAX_CHUNK, Math.max(CHUNK_SIZE_MIN, negotiated - 4));

    try {
      while (
        offset < t.size &&
        t.status === 'transferring' &&
        t.transport === 'dc'
      ) {
        if (dc.readyState !== 'open') throw new Error('Connection lost');

        // Flow control: wait until the send buffer drains before continuing.
        if (dc.bufferedAmount > BUFFER_HIGH_WATER) {
          await this._waitForDrain(dc);
          if (dc.readyState !== 'open') throw new Error('Connection lost');
          continue;
        }

        const end = Math.min(offset + chunkSize, t.size);
        const chunk = await readFileAsArrayBuffer(t.fileRef.slice(offset, end));

        // Frame: 4-byte transfer id prefix + chunk payload.
        const framed = new Uint8Array(4 + chunk.byteLength);
        new DataView(framed.buffer).setUint32(0, t.remoteId);
        framed.set(new Uint8Array(chunk), 4);
        dc.send(framed.buffer);

        offset = end;
        t.sent = offset;
        this._sampleSpeed(t);
        this._emitThrottled();

        // Slow direct link + plenty left to send → hand the rest over to the
        // TCP relay transport (it resumes exactly at this offset).
        if (
          this._socket?.connected &&
          !t.relayTried &&
          t.sent > RELAY_MIN_SENT &&
          t.size - t.sent > RELAY_MIN_REMAIN &&
          t.speed > 0 &&
          t.speed < RELAY_SWITCH_SPEED
        ) {
          this._switchToRelay(peerId, key);
          return;
        }
      }

      if (t.status === 'transferring' && t.transport === 'dc') {
        dc.send(JSON.stringify({ t: 'done', id: t.remoteId }));
        t.status = 'done';
        t.speed = averageSpeed(t);
        this._emit();
      }
    } catch (err) {
      if (t.status === 'transferring' && t.transport === 'dc') {
        t.status = 'failed';
        t.error = err.message;
        t.speed = 0;
        this._emit();
      }
    }
  }

  /**
   * Hand an in-flight transfer over to the TCP relay transport.
   * CRITICAL ordering rule: the ordered DataChannel must drain to zero
   * buffered bytes BEFORE any relay frame is sent — otherwise a late P2P
   * chunk could be interleaved after relay chunks and corrupt the file.
   */
  async _switchToRelay(peerId, key) {
    const peer = this.peers.get(peerId);
    const t = this.transfers.get(key);
    if (!peer || !t || t.transport !== 'dc') return;
    t.transport = 'switching';
    t.relayTried = true; // one switch attempt per transfer — never ping-pong
    this._emitThrottled();

    // Poll the buffer instead of waiting on the bufferedamountlow event:
    // that event only fires on a threshold CROSSING (channel threshold is
    // 1 MB), so a "drain all the way to zero" event-wait would hang forever.
    // The deadline only counts STALLED time: while the buffer keeps shrinking
    // (slow link draining e.g. 4 MB at ~600 KB/s ≈ 7 s) we keep waiting.
    let lastAmount = peer.dc ? peer.dc.bufferedAmount : 0;
    let lastProgress = performance.now();
    try {
      while (
        t.status === 'transferring' &&
        peer.dc &&
        peer.dc.readyState === 'open' &&
        peer.dc.bufferedAmount > 0
      ) {
        await new Promise((r) => setTimeout(r, 50));
        const amount = peer.dc ? peer.dc.bufferedAmount : 0;
        if (amount < lastAmount) {
          lastAmount = amount;
          lastProgress = performance.now();
        } else if (performance.now() - lastProgress > 6000) {
          break; // nothing moved for 6 s — the direct link is wedged
        }
      }
    } catch {
      /* fall through to state checks below */
    }

    if (t.status !== 'transferring' || t.transport !== 'switching') return;

    if (
      !this._socket?.connected ||
      (peer.dc && peer.dc.readyState === 'open' && peer.dc.bufferedAmount > 0)
    ) {
      // Can't switch — resume on the DataChannel where we left off.
      t.transport = 'dc';
      this._pump(peerId, key);
      return;
    }

    // Give the last in-flight SCTP data a moment to be delivered before the
    // first relay frame overtakes it on the websocket (ordering safety).
    await new Promise((r) => setTimeout(r, 200));

    t.transport = 'relay';
    this.onToast?.({ kind: 'relay', fileName: t.name });
    // Tell the receiver to start ACKing relayed chunks (ordered with the
    // chunk stream that follows on the same socket).
    this._socket.emit('relay-chunk', {
      to: peerId,
      frame: JSON.stringify({ t: 'relay-on', id: t.remoteId }),
    });
    this._pumpRelay(peerId, key);
  }

  /**
   * Relay transport pump: same read/frame loop as the DataChannel pump, but
   * chunks travel over the Socket.io websocket (TCP) with credit-based flow
   * control driven by the receiver's relay-ack messages.
   */
  async _pumpRelay(peerId, key) {
    const t = this.transfers.get(key);
    const peer = this.peers.get(peerId);
    if (!t) return;
    const socket = this._socket;
    let offset = t.sent;
    t.relayStartedAt = performance.now();

    try {
      while (offset < t.size && t.status === 'transferring' && t.transport === 'relay') {
        if (!socket?.connected) throw new Error('Relay connection lost');

        // Watchdog: unacked chunks with no ack for 8 s means the receiver
        // isn't crediting (e.g. a tab still running the old build, or lost
        // acks). Ordered delivery guarantees the receiver already holds every
        // byte below t.sent, so resuming on the DataChannel is safe.
        if (
          t.relaySentChunks > t.relayAckedChunks &&
          performance.now() - (t.lastRelayAckAt ?? t.relayStartedAt) > 8000
        ) {
          this._flushWaiters(t);
          if (peer?.dc && peer.dc.readyState === 'open') {
            t.transport = 'dc';
            this._pump(peerId, key);
            return;
          }
          throw new Error('Relay stalled — receiver stopped acknowledging');
        }

        // Credit window: wait until the receiver ACKs enough chunks. The
        // 2 s tick keeps the loop alive so the watchdog below gets checked
        // even when no ack ever arrives.
        while (t.relaySentChunks - t.relayAckedChunks >= RELAY_WINDOW_CHUNKS) {
          await Promise.race([
            new Promise((resolve) => t.waiters.push(resolve)),
            new Promise((r) => setTimeout(r, 2000)),
          ]);
          if (t.status !== 'transferring' || t.transport !== 'relay') return;
          // Window full and still no acks → break out so the watchdog at the
          // top of the outer loop can fall back to the DataChannel.
          if (
            t.relaySentChunks > t.relayAckedChunks &&
            performance.now() - (t.lastRelayAckAt ?? t.relayStartedAt) > 8000
          ) {
            break;
          }
        }

        const end = Math.min(offset + RELAY_CHUNK_SIZE, t.size);
        const chunk = await readFileAsArrayBuffer(t.fileRef.slice(offset, end));
        const framed = new Uint8Array(4 + chunk.byteLength);
        new DataView(framed.buffer).setUint32(0, t.remoteId);
        framed.set(new Uint8Array(chunk), 4);
        socket.emit('relay-chunk', { to: peerId, frame: framed.buffer });

        t.relaySentChunks++;
        offset = end;
        t.sent = offset;
        this._sampleSpeed(t);
        this._emitThrottled();
      }

      if (t.status === 'transferring' && t.transport === 'relay') {
        socket.emit('relay-chunk', {
          to: peerId,
          frame: JSON.stringify({ t: 'done', id: t.remoteId }),
        });
        t.status = 'done';
        t.speed = averageSpeed(t);
        this._flushWaiters(t);
        this._emit();
      }
    } catch (err) {
      if (t.status === 'transferring' && t.transport === 'relay') {
        t.status = 'failed';
        t.error = err.message;
        t.speed = 0;
        this._flushWaiters(t);
        this._emit();
      }
    }
  }

  /** Resolve every relay flow-control waiter. */
  _flushWaiters(t) {
    const waiters = t.waiters;
    t.waiters = [];
    waiters.forEach((resolve) => resolve());
  }

  /** Resolve once the channel's buffered amount drops below the threshold. */
  _waitForDrain(dc) {
    return new Promise((resolve) => {
      // The bufferedamountlow event only fires on a NEW crossing of the
      // threshold — if the buffer is already at/below it (or the channel
      // closed), waiting for the event would hang forever.
      if (
        dc.readyState !== 'open' ||
        dc.bufferedAmount <= (dc.bufferedAmountLowThreshold || 0)
      ) {
        resolve();
        return;
      }
      const cleanup = () => {
        clearTimeout(timeout);
        dc.removeEventListener('bufferedamountlow', onLow);
        dc.removeEventListener('close', onClose);
      };
      const onLow = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        resolve();
      };
      // Safety net so a wedged SCTP buffer can never hang a transfer forever.
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, 30000);
      dc.addEventListener('bufferedamountlow', onLow);
      dc.addEventListener('close', onClose);
    });
  }

  /* ── Speed sampling & state emission ───────────────────────────────────── */

  /**
   * Inspect the WebRTC stats to determine WHICH network path the connection
   * actually took: 'host↔host' = direct on the LAN (fast), 'srflx↔srflx' =
   * relayed/hairpinned through the NAT/firewall (often throttled). Shown in
   * the UI diagnostics line to explain slow transfers.
   */
  async _inspectPath(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer?.pc) return;
    try {
      const stats = await peer.pc.getStats();
      const localCands = new Map();
      const remoteCands = new Map();
      let pair = null;
      stats.forEach((report) => {
        if (report.type === 'local-candidate') localCands.set(report.id, report);
        else if (report.type === 'remote-candidate') remoteCands.set(report.id, report);
        else if (
          report.type === 'candidate-pair' &&
          report.state === 'succeeded' &&
          (report.nominated || report.selected)
        ) {
          pair = report;
        }
      });
      if (!pair) return;
      const lc = localCands.get(pair.localCandidateId);
      const rc = remoteCands.get(pair.remoteCandidateId);
      if (lc && rc) {
        peer.path = `${lc.candidateType}↔${rc.candidateType}`;
        peer.rtt = pair.currentRoundTripTime != null ? pair.currentRoundTripTime : null;
        console.info(
          `[p2p] path to ${peer.name}: ${peer.path}` +
            (peer.rtt != null ? ` · rtt ${(peer.rtt * 1000).toFixed(0)}ms` : ''),
        );
      }
    } catch {
      /* stats unavailable */
    }
  }

  /** Exponentially-smoothed instantaneous speed, sampled every ~200 ms. */
  _sampleSpeed(t) {
    const now = performance.now();
    const dt = now - t.lastSample.time;
    if (dt < SPEED_SAMPLE_MS) return;
    const bytes = t.direction === 'send' ? t.sent : t.received;
    const inst = (bytes - t.lastSample.bytes) / (dt / 1000);
    t.speed = t.speed ? t.speed * 0.6 + inst * 0.4 : inst;
    t.lastSample = { time: now, bytes };
  }

  /** Heartbeat: zero out the speed of stalled transfers, keep UI fresh. */
  _tick() {
    const now = performance.now();
    let active = false;
    for (const t of this.transfers.values()) {
      if (['transferring', 'receiving'].includes(t.status)) {
        active = true;
        if (now - t.lastSample.time > STALL_TIMEOUT && t.speed !== 0) {
          t.speed = 0;
          this._emitThrottled();
        }
      }
    }
    // Refresh the network-path diagnostics while devices are linked.
    this.peers.forEach((peer, id) => {
      if (peer.pc?.connectionState === 'connected') this._inspectPath(id);
    });
    if (active) this._emitThrottled();
  }

  /** Full state snapshot handed to React (internal refs stripped). */
  _snapshot() {
    const peers = Array.from(this.peers.values()).map((peer) => {
      let status = this._linkStatus(peer);
      const busy = Array.from(this.transfers.values()).some(
        (t) => t.peerId === peer.id && ['transferring', 'receiving'].includes(t.status),
      );
      if (busy) status = 'transferring';
      return {
        id: peer.id,
        name: peer.name,
        device: peer.device,
        status,
        /* live WebRTC diagnostics (shown on the peer card for debugging) */
        ice: peer.pc?.iceConnectionState ?? null,
        gather: peer.pc?.iceGatheringState ?? null,
        dc: peer.dc ? peer.dc.readyState : null,
        path: peer.path ?? null,
        rtt: peer.rtt ?? null,
      };
    });

    const transfers = Array.from(this.transfers.values()).map(
      ({ parts, fileRef, lastSample, waiters, ...rest }) => ({
        ...rest,
        transferred: rest.direction === 'send' ? rest.sent : rest.received,
      }),
    );

    return {
      connected: !!this._socket?.connected,
      me: { id: this._myId, name: this._name, device: this._device },
      room: this._room,
      peers,
      transfers,
    };
  }

  /** Human-facing link status derived from the raw WebRTC state. */
  _linkStatus(peer) {
    if (!peer.pc || ['failed', 'closed'].includes(peer.pc.connectionState)) {
      return 'online'; // known via signaling, no WebRTC link (yet/anymore)
    }
    if (peer.pc.connectionState === 'connected') {
      return peer.dc?.readyState === 'open' ? 'connected' : 'connecting';
    }
    return 'connecting';
  }

  _emit() {
    if (this._emitTimer) {
      clearTimeout(this._emitTimer);
      this._emitTimer = null;
    }
    this.onState?.(this._snapshot());
  }

  _emitThrottled() {
    if (this._emitTimer) return;
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      this._emit();
    }, EMIT_INTERVAL);
  }

  _signal(to, payload) {
    this._socket?.emit('signal', { to, payload });
  }
}
