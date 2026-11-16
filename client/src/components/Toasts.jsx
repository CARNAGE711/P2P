/**
 * Toasts — transient notifications (incoming file announcements, completed
 * downloads) stacked in the bottom-right corner. Auto-dismissed by the hook.
 */

import { Bell, CheckCircle2, Download, Zap } from 'lucide-react';

const KIND_ICONS = {
  incoming: { icon: Bell, classes: 'text-amber-300 bg-amber-500/15' },
  received: { icon: Download, classes: 'text-emerald-300 bg-emerald-500/15' },
  relay: { icon: Zap, classes: 'text-indigo-300 bg-indigo-500/15' },
};

const KIND_TITLES = {
  incoming: (t) => `${t.peerName} is sending a file`,
  received: () => 'File received',
  relay: () => '⚡ Turbo relay engaged — direct link was slow',
};

export default function Toasts({ toasts }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => {
        const meta = KIND_ICONS[toast.kind] || KIND_ICONS.incoming;
        const Icon = meta.icon;
        return (
          <div
            key={toast.id}
            className="flex animate-fade-in-up items-start gap-3 rounded-xl border border-slate-700 bg-slate-900/95 p-3 shadow-xl shadow-black/40 backdrop-blur"
          >
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.classes}`}>
              <Icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-100">
                {KIND_TITLES[toast.kind]
                  ? KIND_TITLES[toast.kind](toast)
                  : 'Notification'}
              </p>
              <p className="truncate text-xs text-slate-400">{toast.fileName}</p>
            </div>
            {toast.kind === 'received' && <CheckCircle2 size={16} className="mt-1 shrink-0 text-emerald-400" />}
          </div>
        );
      })}
    </div>
  );
}
