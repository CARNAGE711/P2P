import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

/* Crash reporting: uncaught errors / rejections are POSTed to the signaling
 * server so page crashes (blank screens) show up in the dev server log. */
const reportCrash = (kind, message, stack) => {
  try {
    fetch('/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, message, stack, href: window.location.href }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
};
window.addEventListener('error', (e) =>
  reportCrash('error', e.message, e.error?.stack),
);
window.addEventListener('unhandledrejection', (e) =>
  reportCrash('rejection', String(e.reason?.message ?? e.reason), e.reason?.stack),
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
