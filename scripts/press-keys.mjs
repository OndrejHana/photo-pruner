// Appetize CLI 0.16 viewer keyboard transport. Unlike `appetize type`, this
// sends physical key events for letters and digits. Recheck on CLI upgrades.
import { encode } from 'cbor-x';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';

const [sessionFile, ...keys] = process.argv.slice(2);
if (!sessionFile || !keys.length) throw new Error('Usage: node scripts/press-keys.mjs SESSION_JSON 5 y ArrowLeft');
const { viewerUrl } = JSON.parse(readFileSync(sessionFile, 'utf8'));
const endpoint = new URL('/ws', viewerUrl);
if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw new Error('Expected a local Appetize viewer URL.');
endpoint.protocol = 'ws:';
const ws = new WebSocket(endpoint);
const deadline = AbortSignal.timeout(15000);
try {
  await once(ws, 'open', { signal: deadline });
  for (const key of keys) {
    if (![...['y', 'n', 'u', '0', '1', '2', '3', '4', '5'], 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) throw new Error(`Unsupported review key: ${key}`);
    if (ws.readyState !== WebSocket.OPEN) throw new Error('Appetize viewer disconnected.');
    ws.send(encode({ jsonrpc: '2.0', method: 'appetizeio.device.server.keyboard.press', params: { key } }));
    await setTimeout(300, undefined, { signal: deadline });
  }
} finally {
  ws.close();
}
console.log(`Sent ${keys.length} key presses. Inspect the device to verify the result.`);
