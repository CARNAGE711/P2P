/**
 * RadarView — device discovery radar.
 * A rotating sweep over concentric rings; remote peers appear as status-coded
 * dots positioned evenly around the circle, with "me" in the center.
 */

import { Laptop, Smartphone, Tablet, Loader2 } from 'lucide-react';

/* Status → [dot color, label] used here and in PeerCard */
export const STATUS_STYLES = {
  online: { dot: 'bg-slate-400', text: 'text-slate-400', label: 'Online' },
  connecting: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300', label: 'Connecting…' },
  connected: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Connected' },
  transferring: { dot: 'bg-sky-400 animate-pulse', text: 'text-sky-300', label: 'Transferring' },
};

const DEVICE_ICONS = { desktop: Laptop, phone: Smartphone, tablet: Tablet };

export default function RadarView({ me, peers }) {
  const count = peers.length;

  return (
    <div className="flex flex-col items-center">
      <div className="relative mx-auto aspect-square w-full max-w-[340px]">
        {/* Rings + sweep */}
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="sweepGrad" gradientUnits="userSpaceOnUse" x1="50" y1="2" x2="50" y2="50">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[48, 33, 18].map((r) => (
            <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#1e293b" strokeWidth="0.6" />
          ))}
          <circle cx="50" cy="50" r="48" fill="none" stroke="#334155" strokeWidth="0.8" />

          {/* Crosshair */}
          <line x1="50" y1="2" x2="50" y2="98" stroke="#1e293b" strokeWidth="0.4" />
          <line x1="2" y1="50" x2="98" y2="50" stroke="#1e293b" strokeWidth="0.4" />

          {/* Rotating sweep wedge */}
          <g className="animate-spin-slow" style={{ transformOrigin: '50px 50px' }}>
            <path d="M50 50 L50 2 A48 48 0 0 1 86.78 19.13 Z" fill="url(#sweepGrad)" />
            <line x1="50" y1="50" x2="50" y2="2" stroke="#818cf8" strokeWidth="0.7" opacity="0.6" />
          </g>
        </svg>

        {/* Me — center dot */}
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
          <div className="relative">
            <span className="absolute inset-0 rounded-full bg-indigo-500/40 animate-ping-slow" />
            <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 text-white shadow-lg shadow-indigo-500/40">
              <Laptop size={20} />
            </div>
          </div>
          <span className="mt-1.5 max-w-[90px] truncate text-[10px] font-medium text-slate-300">
            {me?.name || 'Me'}
          </span>
        </div>

        {/* Peers — spread evenly around the outer ring */}
        {peers.map((peer, index) => {
          const style = STATUS_STYLES[peer.status] || STATUS_STYLES.online;
          const angle = count === 1 ? -90 : -90 + (360 / count) * index;
          const rad = (angle * Math.PI) / 180;
          const x = 50 + 38 * Math.cos(rad);
          const y = 50 + 38 * Math.sin(rad);
          const Icon = DEVICE_ICONS[peer.device] || Laptop;
          return (
            <div
              key={peer.id}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
              style={{ left: `${x}%`, top: `${y}%` }}
              title={`${peer.name} · ${style.label}`}
            >
              <div className={`relative flex h-9 w-9 items-center justify-center rounded-full border bg-slate-900 ${style.dot === 'bg-slate-400' ? 'border-slate-600' : 'border-slate-600'}`}>
                <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-slate-950 ${style.dot}`} />
                <Icon size={16} className="text-slate-300" />
              </div>
              <span className="mt-1 max-w-[80px] truncate text-[10px] text-slate-400">{peer.name}</span>
            </div>
          );
        })}

        {/* Empty state */}
        {count === 0 && (
          <div className="absolute inset-x-0 bottom-[8%] flex justify-center">
            <span className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin text-indigo-400" />
              Scanning for nearby devices…
            </span>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        {count === 0
          ? 'Share the room code with another device to get started'
          : `${count} device${count > 1 ? 's' : ''} nearby · drop a file on any card to send`}
      </p>
    </div>
  );
}
