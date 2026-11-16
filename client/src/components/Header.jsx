/**
 * Header — persistent top bar once a room is joined:
 * logo, room code (click to copy a shareable link), my identity,
 * signaling-server link health, and a leave button.
 */

import { useState } from 'react';
import { Copy, Check, LogOut, Wifi, WifiOff } from 'lucide-react';
import { shortId } from '../lib/utils';

export default function Header({ me, room, connected, onLeave }) {
  const [copied, setCopied] = useState(false);

  const shareUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', room);
    return url.toString();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="M12 15l5-5" />
              <path d="M12 15l-5-5" />
              <path d="M5 20h14" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight">
            Beam<span className="bg-gradient-to-r from-indigo-400 to-cyan-300 bg-clip-text text-transparent">Drop</span>
          </span>
        </div>

        {/* Room code badge — click to copy invite link */}
        <button
          onClick={copyLink}
          title="Copy invite link"
          className="group ml-2 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm transition hover:border-indigo-500"
        >
          <span className="text-slate-400">Room</span>
          <span className="font-mono font-semibold tracking-widest text-indigo-300">{room}</span>
          {copied ? (
            <Check size={14} className="text-emerald-400" />
          ) : (
            <Copy size={14} className="text-slate-500 transition group-hover:text-indigo-300" />
          )}
        </button>

        <div className="flex-1" />

        {/* My device chip + signaling link health */}
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
              connected
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
            title={connected ? 'Signaling server connected' : 'Reconnecting to signaling server…'}
          >
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {connected ? 'Online' : 'Reconnecting…'}
          </span>
          <span className="hidden rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-300 sm:block">
            {me?.name} · #{shortId(me?.id || '')}
          </span>
          <button
            onClick={onLeave}
            title="Leave room"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 transition hover:border-red-500/60 hover:text-red-300"
          >
            <LogOut size={13} /> Leave
          </button>
        </div>
      </div>
    </header>
  );
}
