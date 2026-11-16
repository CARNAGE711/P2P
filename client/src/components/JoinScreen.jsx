/**
 * JoinScreen — the landing / room-join view.
 * Collects a display name and a room code (prefilled from ?room= in the URL
 * so shared links drop the visitor straight into the right session).
 */

import { useState } from 'react';
import { Zap, Lock, Globe, LogIn, Loader2, Shuffle, ArrowRight } from 'lucide-react';
import { generateRoomCode } from '../lib/utils';

const FEATURES = [
  { icon: Zap, title: 'Direct P2P', text: 'Files travel device-to-device over WebRTC. No cloud, no size limits.' },
  { icon: Lock, title: 'Private', text: 'The server only relays handshakes — it never sees your data.' },
  { icon: Globe, title: 'Room codes', text: 'Share a code, and every device in the room appears on your radar.' },
];

export default function JoinScreen({ onJoin, error }) {
  const [name, setName] = useState(() => localStorage.getItem('beamdrop-name') || '');
  const [room, setRoom] = useState(
    () => new URLSearchParams(window.location.search).get('room')?.toUpperCase() || '',
  );
  const [busy, setBusy] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    const deviceName = name.trim() || 'My device';
    const roomCode = (room.trim() || generateRoomCode()).toUpperCase();
    localStorage.setItem('beamdrop-name', deviceName);
    setBusy(true);
    onJoin({ name: deviceName, room: roomCode });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-12 text-slate-100">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-20%] h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[400px] w-[500px] rounded-full bg-cyan-500/10 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-lg">
        {/* Logo + headline */}
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 shadow-lg shadow-indigo-500/30">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="M12 15l5-5" />
              <path d="M12 15l-5-5" />
              <path d="M5 20h14" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold tracking-tight">
            Beam<span className="bg-gradient-to-r from-indigo-400 to-cyan-300 bg-clip-text text-transparent">Drop</span>
          </h1>
          <p className="mt-2 text-slate-400">
            AirDrop-style file sharing, right in your browser.
          </p>
        </div>

        {/* Join card */}
        <form
          onSubmit={submit}
          className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-black/40 backdrop-blur"
        >
          <label className="block text-sm font-medium text-slate-300">
            Device name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="e.g. Anna's laptop"
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-slate-100 placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />
          </label>

          <label className="mt-4 block text-sm font-medium text-slate-300">
            Room code
            <div className="mt-1.5 flex gap-2">
              <input
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value.toUpperCase())}
                maxLength={24}
                placeholder="Leave empty to create one"
                className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 font-mono tracking-widest text-slate-100 placeholder:font-sans placeholder:tracking-normal placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              />
              <button
                type="button"
                title="Generate a room code"
                onClick={() => setRoom(generateRoomCode())}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 text-sm text-slate-300 transition hover:border-indigo-500 hover:text-indigo-300"
              >
                <Shuffle size={16} />
              </button>
            </div>
          </label>

          {error && (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 py-2.5 font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:from-indigo-500 hover:to-indigo-400 disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Connecting…
              </>
            ) : (
              <>
                <LogIn size={18} /> Join room <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* Feature strip */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-center sm:text-left"
            >
              <Icon size={20} className="mx-auto mb-2 text-indigo-400 sm:mx-0" />
              <p className="text-sm font-semibold text-slate-200">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
