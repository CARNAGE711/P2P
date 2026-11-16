/**
 * App — BeamDrop root component.
 * Phase 1: JoinScreen (name + room code).
 * Phase 2: dashboard — radar of nearby devices, peer cards with drop zones,
 *          a transfer log, and toast notifications.
 */

import { usePeerNetwork } from './hooks/usePeerNetwork';
import JoinScreen from './components/JoinScreen';
import Header from './components/Header';
import RadarView from './components/RadarView';
import PeerCard from './components/PeerCard';
import TransferPanel from './components/TransferPanel';
import FileViewer from './components/FileViewer';
import Toasts from './components/Toasts';

export default function App() {
  const {
    snapshot,
    joined,
    error,
    toasts,
    viewerKey,
    setViewerKey,
    join,
    leave,
    sendFile,
    cancelTransfer,
    dismissTransfer,
  } = usePeerNetwork();

  if (!joined) {
    return <JoinScreen onJoin={join} error={error} />;
  }

  const { me, room, peers, transfers, connected } = snapshot;

  // The transfer currently open in the full-screen viewer (received files
  // open here automatically; nothing is auto-downloaded to disk).
  const viewerTransfer = viewerKey
    ? transfers.find((t) => t.key === viewerKey && t.direction === 'recv')
    : null;
  const senderName = peers.find((p) => p.id === viewerTransfer?.peerId)?.name;
  const openViewer = (key) => setViewerKey(key);
  const closeViewer = () => setViewerKey(null);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header me={me} room={room} connected={connected} onLeave={leave} />

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          {/* Left column: discovery radar */}
          <div className="flex flex-col gap-4">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
              <RadarView me={me} peers={peers} />
            </section>
            {/* On large screens the transfer log sits under the radar */}
            <div className="hidden max-h-[420px] lg:block">
              <TransferPanel
                transfers={transfers}
                onCancel={cancelTransfer}
                onDismiss={dismissTransfer}
                onOpen={openViewer}
              />
            </div>
          </div>

          {/* Right column: peer cards */}
          <div>
            {peers.length === 0 ? (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 text-center">
                <p className="text-sm font-medium text-slate-300">No devices nearby yet</p>
                <p className="mt-1 max-w-xs text-xs text-slate-500">
                  Open BeamDrop on another device, enter room code{' '}
                  <span className="font-mono font-semibold text-indigo-300">{room}</span> and it
                  will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {peers.map((peer) => (
                  <PeerCard
                    key={peer.id}
                    peer={peer}
                    transfers={transfers.filter((t) => t.peerId === peer.id)}
                    onSend={(peerId, file) => {
                      try {
                        sendFile(peerId, file);
                      } catch (err) {
                        console.warn(err.message);
                      }
                    }}
                    onCancel={cancelTransfer}
                    onOpen={openViewer}
                  />
                ))}
              </div>
            )}

            {/* On small screens the transfer log moves below the cards */}
            <div className="mt-6 h-[360px] lg:hidden">
              <TransferPanel
                transfers={transfers}
                onCancel={cancelTransfer}
                onDismiss={dismissTransfer}
                onOpen={openViewer}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Full-screen preview for received files (photos, video, audio, …) */}
      <FileViewer
        transfer={viewerTransfer}
        senderName={senderName}
        onClose={closeViewer}
      />

      <Toasts toasts={toasts} />
    </div>
  );
}
