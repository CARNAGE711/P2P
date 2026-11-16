/**
 * BeamDrop — Signaling Server
 * ---------------------------------------------------------------------------
 * A lightweight Express + Socket.io server whose ONLY job is to help WebRTC
 * peers find each other and exchange handshake payloads. No file data ever
 * touches this server — files stream directly between browsers over
 * RTCDataChannels.
 *
 * Socket events (the signaling protocol):
 *
 *   client → server
 *     join({ room, name, device }, ack)   Join (or create) a room. ack returns
 *                                         the list of peers already present.
 *     signal({ to, payload })             Relay a WebRTC payload (SDP or ICE)
 *                                         to a specific peer in the room.
 *
 *   server → client
 *     joined({ room, me, peers })         Confirm join + current roster.
 *     peer-joined({ peer })               A new device joined the room.
 *     peer-left({ id })                   A device left the room.
 *     signal({ from, payload })           A relayed signaling payload.
 * ---------------------------------------------------------------------------
 */

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ─── App & Socket.io bootstrap ──────────────────────────────────────────── */

const app = express();
const server = http.createServer(app);

// CORS is wide open in dev; the signaling payloads are harmless, but lock the
// `origin` down in production if the server is exposed publicly.
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e6, // signaling payloads are tiny; reject anything huge
});

/* ─── Room registry ────────────────────────────────────────────────────────
 * rooms: Map<roomCode, Map<socketId, { id, name, device, joinedAt }>>
 */

const rooms = new Map();

/** Room codes are uppercase alphanumeric, 3–24 chars. */
const sanitizeRoom = (room) =>
  String(room || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);

/** Snapshot of every peer currently sitting in a room. */
const listPeers = (room) => Array.from(rooms.get(room)?.values() ?? []);

/* ─── REST endpoints (health check + production static hosting) ──────────── */

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    peers: [...rooms.values()].reduce((n, r) => n + r.size, 0),
  });
});

// Crash reports from browser tabs land here (kind, message, stack).
app.use(express.json({ limit: '64kb' }));
app.post('/client-error', (req, res) => {
  const { kind, message, stack, href } = req.body || {};
  console.error(`[client-crash:${kind}] ${href}\n  ${message}\n${stack || '(no stack)'}`);
  res.json({ ok: true });
});

// In production, serve the built client (client/dist) from this same server.
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

/* ─── Signaling logic ────────────────────────────────────────────────────── */

io.on('connection', (socket) => {
  let currentRoom = null;

  /** Remove this socket from its room and notify the survivors. */
  const leaveRoom = () => {
    if (!currentRoom) return;
    const roster = rooms.get(currentRoom);
    if (roster) {
      roster.delete(socket.id);
      if (roster.size === 0) rooms.delete(currentRoom);
    }
    io.to(currentRoom).emit('peer-left', { id: socket.id });
    console.log(`[leave] ${socket.id} left room ${currentRoom}`);
    currentRoom = null;
  };

  /* -- Room joining ------------------------------------------------------ */

  socket.on('join', ({ room, name, device } = {}, ack) => {
    const code = sanitizeRoom(room);
    if (!code) {
      ack?.({ error: 'Invalid room code' });
      return;
    }

    // If the socket somehow re-joins, clean up the previous membership first.
    if (currentRoom) leaveRoom();

    currentRoom = code;
    if (!rooms.has(code)) rooms.set(code, new Map());

    const peer = {
      id: socket.id,
      name: String(name || 'Unnamed device').trim().slice(0, 32) || 'Unnamed device',
      device: ['phone', 'tablet', 'desktop'].includes(device) ? device : 'desktop',
      joinedAt: Date.now(),
    };
    rooms.get(code).set(socket.id, peer);
    socket.join(code);

    // Tell everyone ALREADY in the room about the newcomer...
    const others = listPeers(code).filter((p) => p.id !== socket.id);
    others.forEach((p) => io.to(p.id).emit('peer-joined', { peer }));

    // ...and hand the newcomer the current roster so it can render instantly
    // (each side then decides who initiates the WebRTC offer — see client).
    socket.emit('joined', { room: code, me: peer, peers: others });
    ack?.({ ok: true, room: code, me: peer, peers: others });
    console.log(`[join] ${peer.name} (${socket.id}) joined room ${code} as ${peer.device}`);
  });

  /* -- Signaling relay (offer / answer / ICE candidates) ------------------ */

  socket.on('signal', ({ to, payload } = {}) => {
    if (!to || !payload) return;
    // Log candidate types so slow-transfer issues can be diagnosed: 'host'
    // candidates = direct LAN path, 'srflx' = bouncing through the NAT.
    if (payload.sdp) {
      console.log(`[signal] ${socket.id} -> ${to} : sdp ${payload.sdp.type}`);
    } else if (payload.candidate) {
      const c = payload.candidate.candidate || '';
      const typ = (c.match(/typ (\w+)/) || [])[1] || 'unknown';
      const addr = (c.match(/(\d{1,3}(?:\.\d{1,3}){3}|[\w-]+\.local)/i) || [])[1] || '?';
      console.log(`[signal] ${socket.id} -> ${to} : ice ${typ} ${addr}`);
    }
    io.to(to).emit('signal', { from: socket.id, payload });
  });

  /* -- Bulk relay fallback (TCP) ------------------------------------------
   * When the direct P2P path is throttled (e.g. inter-VLAN UDP shaping),
   * the sender switches mid-transfer and streams the same framed chunks
   * over this event instead. The server just forwards them — it relays
   * opaque bytes and never parses file data. The receiver ACKs so the
   * sender can apply back-pressure.
   */
  socket.on('relay-chunk', ({ to, frame } = {}) => {
    if (!to || frame === undefined || frame === null) return;
    // Log the first frame and then every 100th so relay activity (and its
    // absence during a stall) is visible without flooding the log.
    const stats = socket.__relayStats || (socket.__relayStats = { frames: 0 });
    stats.frames++;
    if (stats.frames === 1 || stats.frames % 100 === 0) {
      console.log(`[relay] ${socket.id} -> ${to} : ${stats.frames} frames forwarded`);
    }
    io.to(to).emit('relay-chunk', { from: socket.id, frame });
  });

  socket.on('relay-ack', ({ to, id, count } = {}) => {
    if (!to || id === undefined) return;
    io.to(to).emit('relay-ack', { from: socket.id, id, count });
  });

  socket.on('disconnect', leaveRoom);
});

/* ─── Boot ───────────────────────────────────────────────────────────────── */

server.listen(PORT, () => {
  console.log(`BeamDrop signaling server listening on http://localhost:${PORT}`);
});
