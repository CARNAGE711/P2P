import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Vite dev server config.
// `host: true` exposes the app on the LAN (e.g. https://192.168.x.x:5173) so
// phones and other machines on the same network can open it — essential for
// an AirDrop-style app. `basicSsl` serves a self-signed HTTPS certificate:
// browsers only allow RTCPeerConnection on secure origins, so a phone opening
// plain http://<lan-ip> would be blocked. With HTTPS the phone just has to
// accept the certificate warning once.
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      // One-off network speed test (tools/speedtest-server.cjs on :8888),
      // proxied so the HTTPS page can fetch it without mixed-content blocks.
      '/speedfile': {
        target: 'http://localhost:8888',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/speedfile/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
