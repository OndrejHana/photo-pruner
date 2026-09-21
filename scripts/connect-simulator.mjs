import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) throw new Error('Pass the Metro HTTP(S) tunnel URL.');
mkdirSync('evidence', { recursive: true });
const run = (...args) => execFileSync('./scripts/appetize.sh', args, { encoding: 'utf8', timeout: 55000 });
const flatten = node => [node, ...(node.children ?? []).flatMap(flatten)];
function inspect(name) { run('inspect', `evidence/${name}.json`); return JSON.parse(readFileSync(`evidence/${name}.json`)); }
run('inspect', 'evidence/launcher-ready.json', '--select-text', 'Enter URL manually', '--timeout', '15000');
const launch = inspect('connect-launch');
if (!flatten(launch.root).some(n => n.attributes?.label === 'Enter URL manually')) throw new Error('Development launcher is not visible. Inspect evidence/connect-launch.json.');
if (!flatten(launch.root).some(n => n.attributes?.elementType === 'TextField')) run('tap', '--select-text', 'Enter URL manually', '--select-index', '0');
const entry = inspect('connect-entry');
const field = flatten(entry.root).find(n => n.attributes?.elementType === 'TextField');
if (!field) throw new Error('URL field not found.');
const root = flatten(entry.root).filter(n => n.attributes?.elementType === 'Window').map(n => n.bounds).sort((a, b) => b.width * b.height - a.width * a.height)[0];
if (!root?.width || !root.height) throw new Error('Device window dimensions missing.');
const { x, y, width, height } = field.bounds;
run('tap', '--select-position', `${(x + width / 2) / root.width},${(y + height / 2) / root.height}`);
run('type', url);
run('tap', '--select-text', 'Connect', '--timeout', '10000');
run('screenshot', 'evidence/connect-loading');
const deadline = Date.now() + 45000;
let ready = false;
while (Date.now() < deadline) {
  const nodes = flatten(inspect('connect-status').root);
  if (nodes.some(n => n.attributes?.label === 'Error loading app')) throw new Error('Metro connection failed. Check the tunnel before retrying.');
  if (nodes.some(n => n.attributes?.label === 'Continue')) {
    run('tap', '--select-text', 'Continue', '--select-index', '0');
    const menu = flatten(inspect('connect-menu').root);
    const toolsLabel = menu.find(n => n.attributes?.label === 'Tools button');
    const toggle = menu.find(n => n.attributes?.elementType === 'Switch' && n.attributes.value === '1' && n.bounds.width < 100 && toolsLabel && Math.abs(n.bounds.y - toolsLabel.bounds.y) < 25);
    const window = menu.find(n => n.attributes?.elementType === 'Window')?.bounds;
    if (toggle && window) {
      const b = toggle.bounds;
      run('tap', '--select-position', `${(b.x + b.width / 2) / window.width},${(b.y + b.height / 2) / window.height}`);
    }
    run('tap', '--select-text', 'Close', '--select-index', '0', '--timeout', '10000');
  } else if (nodes.some(n => n.attributes?.identifier === 'sample-folder')) {
    ready = true;
    break;
  }
}
if (!ready) throw new Error('App did not become ready. Inspect evidence/connect-status.json.');
run('screenshot', 'evidence/connect-ready');
console.log('Development client connected and Photo Pruner is ready.');
