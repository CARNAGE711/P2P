/**
 * FileViewer — full-screen in-browser preview for received files.
 * Renders photos, videos, audio, PDFs and text inline; anything else falls
 * back to a download prompt. The user saves explicitly — nothing auto-hits
 * the disk.
 */

import { useEffect, useState } from 'react';
import { X, Download, FileQuestion, ArrowDownToLine } from 'lucide-react';
import { formatBytes, truncateName } from '../lib/utils';

const isTextMime = (mime = '') =>
  mime.startsWith('text/') || mime.includes('json') || mime.includes('xml');

export default function FileViewer({ transfer, senderName, onClose }) {
  const [text, setText] = useState(null);
  const [broken, setBroken] = useState(false); // preview failed to render

  const url = transfer?.url;
  const mime = transfer?.mime || '';

  /* Load text content lazily when previewing a text-like file. */
  useEffect(() => {
    setText(null);
    setBroken(false);
    if (transfer && isTextMime(transfer.mime)) {
      fetch(transfer.url)
        .then((r) => r.text())
        .then(setText)
        .catch(() => setBroken(true));
    }
  }, [transfer?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!transfer || !url) return null;

  const kind = broken
    ? 'unknown'
    : mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : mime === 'application/pdf'
            ? 'pdf'
            : isTextMime(mime) && text !== null
              ? 'text'
              : text !== null
                ? 'text'
                : mime
                  ? 'loading'
                  : 'unknown';

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-950/95 backdrop-blur-sm">
      {/* Header: file info + actions */}
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100">
            {truncateName(transfer.name, 48)}
          </p>
          <p className="text-xs text-slate-400">
            {formatBytes(transfer.size)} · from {senderName || 'peer'}
          </p>
        </div>
        <a
          href={url}
          download={transfer.name}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-emerald-500/60 hover:text-emerald-300"
        >
          <Download size={14} /> Save
        </a>
        <button
          onClick={onClose}
          title="Close"
          className="flex items-center rounded-lg border border-slate-700 bg-slate-800/60 p-2 text-slate-300 transition hover:border-red-500/60 hover:text-red-300"
        >
          <X size={16} />
        </button>
      </div>

      {/* Preview area */}
      <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
        {kind === 'image' && (
          <img
            src={url}
            alt={transfer.name}
            onError={() => setBroken(true)}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        )}
        {kind === 'video' && (
          <video
            src={url}
            controls
            autoPlay
            onError={() => setBroken(true)}
            className="max-h-full max-w-full rounded-lg shadow-2xl"
          />
        )}
        {kind === 'audio' && (
          <audio
            src={url}
            controls
            autoPlay
            onError={() => setBroken(true)}
            className="w-full max-w-xl"
          />
        )}
        {kind === 'pdf' && (
          <iframe
            src={url}
            title={transfer.name}
            onError={() => setBroken(true)}
            className="h-full w-full max-w-5xl rounded-lg bg-white"
          />
        )}
        {kind === 'text' && (
          <pre className="h-full w-full max-w-5xl overflow-auto rounded-lg border border-slate-800 bg-slate-900/60 p-4 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
            {text}
          </pre>
        )}
        {kind === 'loading' && (
          <p className="text-sm text-slate-400">Loading preview…</p>
        )}
        {kind === 'unknown' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/60 text-slate-500">
              <FileQuestion size={28} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                No in-browser preview for this file type
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {transfer.mime || 'Unknown format'} · use “Save” above to keep it
              </p>
            </div>
            <a
              href={url}
              download={transfer.name}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:from-indigo-500 hover:to-indigo-400"
            >
              <ArrowDownToLine size={15} /> Save file
            </a>
          </div>
        )}
      </div>

      {/* Click on the dimmed area closes too */}
      <button
        onClick={onClose}
        className="absolute inset-0 -z-10 cursor-default"
        aria-label="Close viewer"
      />
    </div>
  );
}
