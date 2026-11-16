/**
 * TransferPanel — session-wide transfer log in the side column:
 * active transfers up top, recent finished/failed ones below, each with a
 * re-download shortcut for received files.
 */

import { ArrowDownToLine, ArrowUpFromLine, Download, Eye, X, Radio } from 'lucide-react';
import { formatBytes, formatSpeed, formatTime, truncateName } from '../lib/utils';

function Row({ t, onCancel, onDismiss, onOpen }) {
  const pct = t.size > 0 ? Math.min(100, (t.transferred / t.size) * 100) : 100;
  const active = t.status === 'transferring' || t.status === 'receiving';
  const failed = t.status === 'failed' || t.status === 'aborted';

  return (
    <div className="group rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-center gap-2.5">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            t.direction === 'send' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-cyan-500/15 text-cyan-300'
          }`}
        >
          {t.direction === 'send' ? <ArrowUpFromLine size={15} /> : <ArrowDownToLine size={15} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200">{truncateName(t.name, 24)}</p>
          <p className="text-[11px] text-slate-500">
            {formatTime(t.startedAt)} · {formatBytes(t.size)}
            {active && t.speed > 0 && (
              <span className="ml-2 font-mono text-slate-400">{formatSpeed(t.speed)}</span>
            )}
            {t.transport === 'relay' && (
              <span className="ml-2 text-indigo-300">⚡ relay</span>
            )}
          </p>
        </div>
        {active ? (
          <button onClick={() => onCancel(t.key)} title="Cancel" className="text-slate-500 transition hover:text-red-400">
            <X size={15} />
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span
              className={`text-[11px] font-semibold ${
                t.status === 'done' ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {t.status === 'done' ? 'Done' : 'Failed'}
            </span>
            {/* Viewable received files open the in-browser viewer */}
            {t.status === 'done' && t.url && t.direction === 'recv' && (
              <button onClick={() => onOpen(t.key)} title="Show in browser" className="text-slate-500 transition hover:text-indigo-300">
                <Eye size={14} />
              </button>
            )}
            {t.url && (
              <a href={t.url} download={t.name} title="Save" className="text-slate-500 transition hover:text-emerald-300">
                <Download size={14} />
              </a>
            )}
            <button onClick={() => onDismiss(t.key)} title="Dismiss" className="text-slate-600 transition hover:text-slate-300">
              <X size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-[width] duration-150 ${
            failed ? 'bg-red-500/70' : t.direction === 'send' ? 'bg-indigo-400' : 'bg-cyan-400'
          }`}
          style={{ width: `${active || t.status === 'done' ? pct : 100}%` }}
        />
      </div>
    </div>
  );
}

export default function TransferPanel({ transfers, onCancel, onDismiss, onOpen }) {
  const active = transfers.filter((t) => ['transferring', 'receiving'].includes(t.status));
  const finished = transfers.filter((t) => !['transferring', 'receiving'].includes(t.status)).reverse();

  return (
    <aside className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
        <Radio size={15} className="text-indigo-400" /> Transfers
      </h2>

      {transfers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-800 text-slate-600">
            <ArrowUpFromLine size={18} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            No transfers yet.
            <br />
            Drop a file on a device card to send one.
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {active.length > 0 && (
            <>
              <p className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Active
              </p>
              {active.map((t) => (
                <Row key={t.key} t={t} onCancel={onCancel} onDismiss={onDismiss} onOpen={onOpen} />
              ))}
            </>
          )}
          {finished.length > 0 && (
            <>
              <p className="pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Recent
              </p>
              {finished.map((t) => (
                <Row key={t.key} t={t} onCancel={onCancel} onDismiss={onDismiss} onOpen={onOpen} />
              ))}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
