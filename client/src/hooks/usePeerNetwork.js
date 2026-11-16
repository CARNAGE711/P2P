/**
 * usePeerNetwork — React binding for the PeerNetwork engine.
 * ---------------------------------------------------------------------------
 * Owns the PeerNetwork instance across renders, mirrors its snapshots into
 * React state, and manages transient toast notifications.
 */

import { useCallback, useRef, useState } from 'react';
import PeerNetwork from '../lib/peerNetwork';

export function usePeerNetwork() {
  /** Latest snapshot from the engine: { me, room, peers, transfers, connected } */
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);

  const networkRef = useRef(null);
  const toastSeq = useRef(0);

  /** Key of the transfer currently open in the in-browser file viewer. */
  const [viewerKey, setViewerKey] = useState(null);

  /** Push a toast that auto-dismisses after 5 seconds. */
  const pushToast = useCallback((toast) => {
    const id = ++toastSeq.current;
    setToasts((list) => [...list.slice(-3), { id, ...toast }]);
    // A completed incoming transfer opens automatically in the viewer
    // (the engine no longer auto-downloads files).
    if (toast.kind === 'received' && toast.key) setViewerKey(toast.key);
    setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  /** Join a room — creates and starts the network engine. */
  const join = useCallback(
    ({ name, room }) => {
      setError(null);
      try {
        const network = new PeerNetwork({
          serverUrl: '/',
          onState: setSnapshot,
          onToast: pushToast,
        });
        networkRef.current = network;
        network.join({ name, room });
      } catch (err) {
        setError(err.message || 'Failed to connect');
      }
    },
    [pushToast],
  );

  /** Leave the room and return to the join screen. */
  const leave = useCallback(() => {
    networkRef.current?.destroy();
    networkRef.current = null;
    setSnapshot(null);
    setToasts([]);
    // Full reload guarantees a clean WebRTC state.
    window.location.reload();
  }, []);

  /** Send a file (or list of files) to a peer. */
  const sendFile = useCallback((peerId, file) => {
    return networkRef.current?.sendFile(peerId, file);
  }, []);

  const cancelTransfer = useCallback((key) => {
    networkRef.current?.cancelTransfer(key);
  }, []);

  const dismissTransfer = useCallback((key) => {
    networkRef.current?.dismissTransfer(key);
  }, []);

  return {
    snapshot, // null until joined
    joined: !!snapshot,
    error,
    toasts,
    viewerKey,
    setViewerKey,
    join,
    leave,
    sendFile,
    cancelTransfer,
    dismissTransfer,
  };
}
