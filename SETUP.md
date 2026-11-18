# Setup — run BeamDrop on a new device

## 1. One-time installs

| Need | Get it |
|---|---|
| **Node.js 18+** (LTS) | [nodejs.org](https://nodejs.org) |
| **Git** | [git-scm.com](https://git-scm.com) |

Verify:
```bash
node --version
npm --version
git --version
```

## 2. Clone & install (once per machine)

```bash
git clone https://github.com/CARNAGE711/P2P.git
cd P2P
npm install
npm install --prefix server
npm install --prefix client
```

Three installs cover root tooling, the signaling server, and the client app.

## 3. Run (every time)

```bash
npm run dev
```

Two processes start together:
- Signaling server → `http://localhost:3001`
- Vite dev server → `https://localhost:5173` (and `https://<PC-IP>:5173` on your LAN)

Windows will ask to allow Node through the firewall — **click Allow** (private networks), or phones can't reach your PC.

## 4. Open on your devices

- **Same PC:** `https://localhost:5173`
- **Phone / another PC:** `https://<this-PC's-IP>:5173/`  
  The LAN IP is shown in the terminal (`Network: https://10.17.5.60:5173/`).

On the phone, accept the self-signed-certificate warning — it's normal; the dev cert isn't publicly trusted.

Both devices pick a device name and enter the **same room code**, then drop a file onto any device card.

## 5. Production mode (optional)

Serves the built app from the Express server on port 3001 — no Vite needed:

```bash
npm run build
npm start
```

Everything is then on `http://localhost:3001`.

## Requirements
- Both devices must be on the same network (or reachable to your PC). There is no cloud — your PC is the server.
- The optional speed-test page (`/speedtest.html`) and `tools/speedtest-server.cjs` are diagnostics only; not needed for normal transfers.
