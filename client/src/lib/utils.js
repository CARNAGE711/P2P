/**
 * Small formatting / helper utilities shared across the UI.
 */

/** Format a byte count as a human-readable string ("1.4 MB", "832 KB", …). */
export function formatBytes(bytes, digits = 1) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const u of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = u;
  }
  return `${value.toFixed(digits)} ${unit}`;
}

/** Format a byte-per-second rate ("2.3 MB/s"). */
export function formatSpeed(bytesPerSecond) {
  return `${formatBytes(bytesPerSecond || 0)}/s`;
}

/** Format a timestamp as a short HH:MM clock string. */
export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Generate a 6-character room code from an unambiguous alphabet
 * (no I, L, O, 0, 1 — they get confused when read aloud).
 */
export function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Short display form of a socket id (used as a device fingerprint). */
export function shortId(id = '') {
  return id.slice(0, 6).toUpperCase();
}

/** Truncate a long file name, keeping the extension visible. */
export function truncateName(name = '', max = 28) {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${name.slice(0, max - ext.length - 1)}…${ext}`;
}
