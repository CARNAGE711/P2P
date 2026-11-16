/**
 * One-off network speed test server.
 * Serves a large zero-filled file so a device can download it and measure
 * the raw routed throughput between the phone and the PC (independent of
 * WebRTC). Plain HTTP on purpose — no certificate friction.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'speedtest.bin');
const SIZE = fs.statSync(FILE).size;

http
  .createServer((req, res) => {
    console.log(`[speedtest] ${req.socket.remoteAddress} requested ${req.url}`);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': SIZE,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="speedtest.bin"',
    });
    fs.createReadStream(FILE).pipe(res);
  })
  .listen(8888, () => console.log(`Speed test server on http://0.0.0.0:8888 (${(SIZE / 1048576) | 0} MB)`));
