/**
 * PeerCard — one device card with a drag-and-drop / click-to-browse zone.
 * Shows the device's live status, and inline progress bars for every transfer
 * currently flowing between me and that peer.
 */

import { useRef, useState } from 'react';
import {
  Laptop,
  Smartphone,
  Tablet,
  UploadCloud,
  ArrowUp,
  ArrowDown,
  X,
  Download,
  Eye,
  AlertCircle,
} from 'lucide-react';
import { STATUS_STYLES } from './RadarView';
import { formatBytes, formatSpeed, truncateName } from '../lib/utils';

const DEVICE_ICONS = { desktop: Laptop, phone: Smartphone, tablet: Tablet };

/** One row per transfer involving this peer. */
function TransferRow({ transfer, onCancel, onOpen }) {
  const t = transfer;
  const pct = t.size > 0 ? Math.min(100, (t.transferred / t.size) * 100) : 100;
  const active = t.status === 'transferring' || t.status === 'receiving';
  const failed = t.status === 'failed' || t.status === 'aborted';

  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        {t.direction === 'send' ? (
          <ArrowUp size={13} className="shrink-0 text-indigo-400" />
        ) : (
          <ArrowDown size={13} className="shrink-0 text-cyan-400" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-slate-200">
          {truncateName(t.name)}
        </span>
        {active && t.speed > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-slate-400">
            {formatSpeed(t.speed)}
          </span>
        )}
        {active ? (
          <button onClick={() => onCancel(t.key)} title="Cancel" className="shrink-0 text-slate-500 transition hover:text-red-400">
            <X size={13} />
          </button>
        ) : (
          <span
            className={`shrink-0 text-[10px] font-semibold ${
              t.status === 'done' ? 'text-emerald-400' : failed ? 'text-red-400' : ''
            }`}
          >
            {t.status === 'done' ? 'Done' : failed ? 'Failed' : t.status}
          </span>
        )}
        {t.status === 'done' && t.url && t.direction === 'recv' && (
          <button onClick={() => onOpen(t.key)} title="Show in browser" className="shrink-0 text-slate-500 transition hover:text-indigo-300">
            <Eye size={13} />
          </button>
        )}
        {t.status === 'done' && t.url && (
          <a
            href={t.url}
            download={t.name}
            title="Save"
            className="shrink-0 text-slate-500 transition hover:text-emerald-300"
          >
            <Download size={13} />
          </a>
        )}
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-700/50">
        <div
          className={`h-full rounded-full transition-[width] duration-150 ${
            failed ? 'bg-red-500/70' : t.direction === 'send' ? 'bg-indigo-400' : 'bg-cyan-400'
          }`}
          style={{ width: `${active || t.status === 'done' ? pct : 100}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>
          {formatBytes(t.transferred)} / {formatBytes(t.size)}
        </span>
        <span>{active || t.status === 'done' ? `${pct.toFixed(0)}%` : ''}</span>
      </div>
      {failed && t.error && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-red-400">
          <AlertCircle size={10} /> {t.error}
        </p>
      )}
    </div>
  );
}

export default function PeerCard({ peer, transfers, onSend, onCancel, onOpen }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const status = STATUS_STYLES[peer.status] || STATUS_STYLES.online;
  const Icon = DEVICE_ICONS[peer.device] || Laptop;
  const linkReady = peer.status === 'connected' || peer.status === 'transferring';

  /** Common send handler for drop + file picker (supports multiple files). */
  const handleFiles = (files) => {
    for (const file of files) onSend(peer.id, file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (linkReady) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (linkReady && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
      }}
      className={`group relative flex animate-fade-in-up flex-col rounded-2xl border p-4 transition-colors ${
        dragOver
          ? 'border-indigo-400 bg-indigo-500/10'
          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
      }`}
    >
      {/* Device header */}
      <div className="flex items-start gap-3">
        <div className="relative">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 text-slate-200 ring-1 ring-slate-700">
            <Icon size={20} />
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-slate-900 ${status.dot}`}
            title={status.label}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-100">{peer.name}</p>
          <p className={`text-xs ${status.text}`}>{status.label}</p>
          {/* Live WebRTC diagnostics — helps pinpoint connection problems */}
          <p className="mt-0.5 font-mono text-[10px] text-slate-500">
            ICE {peer.ice ?? '—'} · path {peer.path ?? '—'}
            {peer.rtt != null ? ` · rtt ${(peer.rtt * 1000).toFixed(0)}ms` : ''} · DC{' '}
            {peer.dc ?? '—'}
          </p>
        </div>
      </div>

      {/* Drop zone / send button */}
      <button
        onClick={() => linkReady && inputRef.current?.click()}
        disabled={!linkReady}
        className={`mt-4 flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-3 py-5 text-center transition ${
          linkReady
            ? 'border-slate-700 text-slate-400 hover:border-indigo-500 hover:text-indigo-300'
            : 'cursor-not-allowed border-slate-800 text-slate-600'
        }`}
      >
        <UploadCloud size={22} className={dragOver ? 'text-indigo-300' : ''} />
        <span className="mt-1.5 text-xs font-medium">
          {linkReady ? 'Drop a file here or click to browse' : 'Waiting for connection…'}
        </span>
        <span className="text-[10px] text-slate-500">Files go directly, device to device</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />

      {/* Active + recent transfers with this peer */}
      {transfers.length > 0 && (
        <div className="mt-3 space-y-2">
          {transfers.map((t) => (
            <TransferRow key={t.key} transfer={t} onCancel={onCancel} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
