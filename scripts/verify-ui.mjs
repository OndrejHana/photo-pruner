// Run against a connected, landscape Appetize session with Sample shoot open.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (...args) => execFileSync('./scripts/appetize.sh', args, { encoding: 'utf8', timeout: 30000 });
const flatten = node => [node, ...(node.children ?? []).flatMap(flatten)];
function check(name, expected) {
  run('inspect', `evidence/${name}.json`);
  const nodes = flatten(JSON.parse(readFileSync(`evidence/${name}.json`)).root);
  for (const [id, label] of Object.entries(expected)) {
    assert.equal(nodes.find(node => node.attributes?.identifier === id)?.attributes?.label, label, id);
  }
  run('screenshot', `evidence/${name}`);
  console.log(`PASS ${name}`);
}
const tap = id => run('tap', '--select-test-id', id);

tap('photo-0');
tap('star-5');
tap('keep');
tap('reject');
check('22-reviewed', { 'selected-name': 'DSC_0003', 'review-summary': '1 kept · 1 rejected' });
tap('undo');
check('23-undo', { 'selected-name': 'DSC_0002', decision: 'Unreviewed', 'review-summary': '1 kept · 0 rejected' });
tap('reject');
tap('photo-0');
check('24-pair-rating', { decision: 'Keep', 'stars-value': '5 / 5 stars', 'paired-files': 'DSC_0001.JPG + DSC_0001.NEF' });
tap('refresh-folder');
run('inspect', 'evidence/rescan-ready.json', '--select-test-id', 'photo-preview', '--timeout', '10000');
check('25-rescan', { decision: 'Keep', 'stars-value': '5 / 5 stars', 'review-summary': '1 kept · 1 rejected' });
tap('photo-3');
run('inspect', 'evidence/raw-error.json', '--select-test-id', 'preview-error', '--timeout', '10000');
check('26-invalid-raw', { 'selected-name': 'DSC_0004' });
tap('photo-0');
