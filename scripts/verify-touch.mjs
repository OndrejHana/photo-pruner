// Drives an already connected Appetize session. Never starts or stops sessions.
// Evidence is ignored by git. Run --help before using a paid device session.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`Usage: node scripts/verify-touch.mjs --phase legacy|swipe|controls|keyboard|persistence|export
  [--session-id ID] [--session-file artifacts/appetize-session.json]
  [--evidence-dir evidence/touch-DATE] [--ids ignored-config.json]
  [--record] [--open-picker]

Requires a connected landscape iPad session with Sample shoot open.
legacy, swipe, controls and keyboard require a fresh, unreviewed four-photo sample.
legacy requires a 1366×1024 landscape session and --session-file for native keys.
persistence leaves one kept photo (5 stars) and one rejected photo for export.
export checks confirmation; --open-picker also opens the native destination picker.
ID config overrides: viewer, browse, browserClose, photoPrefix, name, position,
decision, stars, summary, next, previous, keep, reject, undo, clearStars, rescan,
folderMenu, details, clearDecision, export, exportConfirm, sidebar, previewStatus,
frame, pairedFiles, keyboardHint, openFolder, sampleFolder. Browser selection closes automatically.
Buttons and keys wait only for interactive controls; swipes additionally wait for
preview-status to read Preview ready or Preview unavailable after actual display/error.
Each phase writes assertions.json and screenshots; recordings require --record.
True touch cancellation, multi-touch, and system picker selection are manual checks.
The caller must stop the Appetize session when finished.`);
  process.exit(0);
}
const values = new Map();
const flags = new Set(['--record', '--open-picker']);
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  assert.ok(key.startsWith('--'), `Unexpected argument ${key}`);
  if (flags.has(key)) values.set(key, true);
  else {
    assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), `Missing value for ${key}`);
    values.set(key, args[++index]);
  }
}
const phase = values.get('--phase');
assert.ok(['legacy', 'swipe', 'controls', 'keyboard', 'persistence', 'export'].includes(phase), 'Choose --phase; see --help.');
if (phase === 'legacy' || phase === 'keyboard') assert.ok(values.has('--session-file'), `${phase} requires --session-file for native keyboard events.`);
const directory = resolve(values.get('--evidence-dir') ?? `evidence/touch-${new Date().toISOString().replaceAll(':', '-')}-${phase}`);
assert.ok(directory.startsWith(`${resolve('evidence')}/`), 'Evidence must remain in the ignored evidence directory.');
mkdirSync(directory, { recursive: true });
const ids = {
  viewer: 'swipe-photo', browse: 'browse-photos', browserClose: null, photoPrefix: 'photo-',
  name: 'selected-name', position: 'position', decision: 'decision', stars: 'stars-value',
  summary: 'review-summary', next: 'next', previous: 'previous', keep: 'keep', reject: 'reject',
  undo: 'undo', clearStars: 'clear-stars', rescan: 'refresh-folder', folderMenu: 'folder-menu', export: 'export-keepers',
  details: 'photo-details', clearDecision: 'clear-decision', exportConfirm: 'export-choose-destination',
  sidebar: 'photo-sidebar', previewStatus: 'preview-status', frame: 'preview-frame',
  pairedFiles: 'paired-files', keyboardHint: 'keyboard-hint', openFolder: 'open-folder', sampleFolder: 'sample-folder',
  ...(values.has('--ids') ? JSON.parse(readFileSync(values.get('--ids'), 'utf8')) : {}),
};
const sessionOptions = values.has('--session-id') ? ['--session-id', values.get('--session-id')] : [];
const run = (...command) => {
  results.actions.push({ at: new Date().toISOString(), command });
  return execFileSync('./scripts/appetize.sh', [...command, ...sessionOptions], {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  });
};
const flatten = node => [node, ...(node.children ?? []).flatMap(flatten)];
let sequence = 0;
const results = { phase, startedAt: new Date().toISOString(), status: 'running', assertions: [], actions: [] };
const persist = () => writeFileSync(join(directory, 'assertions.json'), `${JSON.stringify(results, null, 2)}\n`);
function inspect(name, scope) {
  const path = join(directory, `${String(++sequence).padStart(2, '0')}-${name}.json`);
  run('inspect', path, ...(scope ? ['--select-test-id', scope, '--timeout', '10000'] : []));
  return { path, nodes: flatten(JSON.parse(readFileSync(path, 'utf8')).root) };
}
const nodeFor = (nodes, id) => nodes.find(node => node.attributes?.identifier === id);
const labelFor = (nodes, id) => nodeFor(nodes, id)?.attributes?.label;
const tap = id => run('tap', '--select-test-id', id, '--timeout', '10000');
const isEnabled = node => [true, 'true', 1].includes(node?.attributes?.enabled);
function interactionReady() {
  const deadline = Date.now() + 10000;
  do {
    // Review buttons remain usable while a preview loads. This wait covers only
    // folder/export work and a closing sheet, never actual image display.
    const { nodes } = inspect('interaction-ready', ids.keep);
    if (isEnabled(nodeFor(nodes, ids.keep))) return;
  } while (Date.now() < deadline);
  assert.fail('Review controls did not become interactive.');
}
function previewReady() {
  const deadline = Date.now() + 10000;
  do {
    const { nodes } = inspect('preview-ready', ids.previewStatus);
    if (['Preview ready', 'Preview unavailable'].includes(labelFor(nodes, ids.previewStatus))) return;
  } while (Date.now() < deadline);
  assert.fail('Preview did not reach actual display or a settled error state.');
}
function check(name, { index, decision = 'Unreviewed', stars = 0, kept = 0, rejected = 0 }) {
  interactionReady();
  const { path, nodes } = inspect(name);
  assert.equal(labelFor(nodes, ids.name), `DSC_${String(index + 1).padStart(4, '0')}`, `${name}: photo`);
  assert.match(labelFor(nodes, ids.position) ?? '', new RegExp(`^${index + 1} / 4(?:\\b| ·)`), `${name}: position`);
  assert.equal(labelFor(nodes, ids.decision), decision, `${name}: decision`);
  assert.equal(labelFor(nodes, ids.stars), `${stars} / 5 stars`, `${name}: rating`);
  assert.equal(labelFor(nodes, ids.summary), `${kept} kept · ${rejected} rejected`, `${name}: totals`);
  if (phase === 'legacy') {
    assertSidebar(nodes, name);
    assert.ok([true, 'true', 1].includes(nodeFor(nodes, `${ids.photoPrefix}${index}`)?.attributes?.selected), `${name}: sidebar selection must follow the current photo`);
  }
  run('screenshot', path.slice(0, -5));
  results.assertions.push({ name, at: new Date().toISOString(), status: 'passed', index, decision, stars, kept, rejected, hierarchy: path });
  persist();
  console.log(`PASS ${name}`);
}
function select(index) {
  const { nodes } = inspect('before-select');
  if (!nodeFor(nodes, `${ids.photoPrefix}${index}`)) tap(ids.browse);
  tap(`${ids.photoPrefix}${index}`);
  if (ids.browserClose) tap(ids.browserClose);
  interactionReady();
}
function swipe(direction, short = false) {
  interactionReady();
  previewReady();
  inspect(`before-${short ? 'short-' : ''}${direction}`, ids.viewer);
  const end = { right: [0.8, 0.5], left: [0.2, 0.5], up: [0.5, 0.2], down: [0.5, 0.8] }[direction];
  run('swipe', '--from-test-id', ids.viewer, '--from-x', '0.5', '--from-y', '0.5',
    '--to-test-id', ids.viewer, '--to-x', short ? '0.53' : String(end[0]),
    '--to-y', short ? '0.5' : String(end[1]), '--duration', short ? '500' : '400');
}
function key(...keys) {
  const sessionFile = values.get('--session-file');
  assert.ok(sessionFile, 'Keyboard phase requires --session-file.');
  for (const key of keys) {
    interactionReady();
    results.actions.push({ at: new Date().toISOString(), command: ['hardware-key', key] });
    execFileSync(process.execPath, ['scripts/press-keys.mjs', sessionFile, key], {
      encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}
function assertVisible(nodes, identifiers, name) {
  for (const id of identifiers) assert.ok(nodeFor(nodes, id), `${name}: ${id} must remain visible`);
}
function assertSidebar(nodes, name) {
  assertVisible(nodes, [ids.sidebar, ...Array.from({ length: 4 }, (_, index) => `${ids.photoPrefix}${index}`)], name);
}
function assertLegacyLayout(name) {
  const { path, nodes } = inspect(name);
  assertSidebar(nodes, name);
  assertVisible(nodes, [ids.frame, ids.pairedFiles, ids.keyboardHint, ids.openFolder, ids.sampleFolder, ids.rescan], name);
  assert.equal(labelFor(nodes, ids.pairedFiles), 'DSC_0001.JPG + DSC_0001.NEF', 'Pairing stays visible beneath the preview.');
  const hint = labelFor(nodes, ids.keyboardHint) ?? '';
  for (const key of ['Y', 'N', 'U']) assert.match(hint, new RegExp(`(?:^|[^A-Za-z])${key}(?:[^A-Za-z]|$)`, 'i'), `Keyboard hint: ${key}`);
  assert.match(hint, /stars|rating/i, 'Keyboard hint must explain ratings.');
  const screen = nodes.find(node => node.attributes?.elementType === 'Application')?.bounds
    ?? nodes.find(node => node.attributes?.elementType === 'Window')?.bounds;
  assert.ok(screen, 'A native screen bound is required for the layout measurement.');
  assert.equal(screen.width, 1366, 'Legacy layout is measured at 1366×1024 logical points.');
  assert.equal(screen.height, 1024, 'Legacy layout is measured in landscape.');
  const frame = nodeFor(nodes, ids.frame).bounds;
  assert.ok(frame.width >= 833 && frame.height >= 624, `Preview is ${frame.width}×${frame.height}; require at least 833×624.`);
  assert.ok(Math.abs(frame.height - frame.width * 3 / 4) <= 1, `Preview must remain 4:3; measured ${frame.width}×${frame.height}.`);
  run('screenshot', path.slice(0, -5));
  results.assertions.push({ name, at: new Date().toISOString(), status: 'passed', screen, frame, hierarchy: path }); persist();
  console.log(`PASS ${name}`);
}
function directRescan() {
  const { nodes } = inspect('before-rescan');
  if (!nodeFor(nodes, ids.rescan)) tap(ids.folderMenu);
  tap(ids.rescan);
}
function assertExportWorkspace(nodes, path) {
  assertVisible(nodes, [ids.name, ids.viewer, ids.pairedFiles, ids.keyboardHint], 'Inline export');
  const screen = nodes.find(node => node.attributes?.elementType === 'Application')?.bounds;
  if (screen?.width >= 1100) assertSidebar(nodes, 'Inline export');
  const locked = [ids.keep, ids.reject, ids.previous, ids.next, ids.undo, ids.clearStars, ids.clearDecision,
    ids.openFolder, ids.sampleFolder, ids.rescan, ...Array.from({ length: 5 }, (_, index) => `star-${index + 1}`)];
  if (screen?.width >= 1100) locked.push(...Array.from({ length: 4 }, (_, index) => `${ids.photoPrefix}${index}`));
  for (const id of locked) {
    const node = nodeFor(nodes, id);
    assert.ok(node, `Inline export: ${id} must remain visible`);
    assert.ok([false, 'false', 0].includes(node.attributes?.enabled), `Inline export: ${id} must be disabled`);
  }
  results.assertions.push({ name: 'inline-export-retains-locked-workspace', at: new Date().toISOString(), status: 'passed', hierarchy: path }); persist();
  console.log('PASS inline-export-retains-locked-workspace');
}
let recording = false;
try {
  if (values.get('--record')) { run('recording', 'start', join(directory, `${phase}-demo`)); recording = true; }
  if (phase === 'legacy') {
    select(0); check('legacy-initial', { index: 0 });
    assertLegacyLayout('legacy-sidebar-pairing-hints-and-preview-size');
    // Persistent rows must remain usable after every selection, without opening
    // Photos or waiting for image display to complete.
    for (const index of [2, 0, 1, 0]) {
      tap(`${ids.photoPrefix}${index}`); check(`sidebar-repeat-${results.assertions.length}`, { index });
    }
    key('5', 'y'); check('sidebar-keyboard-keep-and-advance', { index: 1, kept: 1 });
    key('n'); check('sidebar-keyboard-reject-and-advance', { index: 2, kept: 1, rejected: 1 });
    key('u'); check('sidebar-keyboard-undo', { index: 1, kept: 1 });
    tap(`${ids.photoPrefix}0`); check('sidebar-revisit-keep-and-rating', { index: 0, decision: 'Keep', stars: 5, kept: 1 });
    key('ArrowRight'); check('sidebar-keyboard-next', { index: 1, kept: 1 });
    key('ArrowLeft'); check('sidebar-keyboard-previous', { index: 0, decision: 'Keep', stars: 5, kept: 1 });
    key('u', 'u'); check('legacy-restore-clean-sample', { index: 0 });
  } else if (phase === 'swipe') {
    select(0); check('initial', { index: 0 });
    swipe('right', true); check('short-drag-does-nothing', { index: 0 });
    swipe('down'); check('previous-at-first-photo', { index: 0 });
    swipe('right'); check('right-keeps-and-advances', { index: 1, kept: 1 });
    tap(ids.undo); check('undo-keep-restores-photo', { index: 0 });
    swipe('left'); check('left-rejects-and-advances', { index: 1, rejected: 1 });
    tap(ids.undo); check('undo-reject-restores-photo', { index: 0 });
    swipe('up'); check('up-next-without-decision', { index: 1 });
    swipe('down'); check('down-previous-without-decision', { index: 0 });
    select(3); swipe('up'); check('next-at-last-photo', { index: 3 });
    swipe('right'); check('keep-last-photo', { index: 3, decision: 'Keep', kept: 1 });
    swipe('right'); tap(ids.undo); check('repeated-last-keep-preserves-undo', { index: 3 });
    select(0);
  } else if (phase === 'controls') {
    select(0); check('initial', { index: 0 });
    tap('star-5'); check('touch-rating', { index: 0, stars: 5 });
    tap(ids.clearStars); check('clear-rating', { index: 0 });
    tap(ids.undo); check('undo-clear-rating', { index: 0, stars: 5 });
    tap(ids.keep); check('keep-button-advances', { index: 1, kept: 1 });
    tap(ids.reject); check('reject-button-advances', { index: 2, kept: 1, rejected: 1 });
    tap(ids.undo); check('undo-reject-button', { index: 1, kept: 1 });
    tap(ids.previous); check('previous-button', { index: 0, decision: 'Keep', stars: 5, kept: 1 });
    const metadata = inspect('before-pair-metadata');
    if (!nodeFor(metadata.nodes, ids.pairedFiles)) tap(ids.details);
    const details = inspect('pair-metadata', ids.pairedFiles);
    assert.equal(labelFor(details.nodes, ids.pairedFiles), 'DSC_0001.JPG + DSC_0001.NEF', 'RAW/JPEG pairing metadata');
    results.assertions.push({ name: 'pair-metadata', at: new Date().toISOString(), status: 'passed', hierarchy: details.path });
    tap(ids.clearDecision); check('clear-decision-stays-on-photo', { index: 0, stars: 5 });
    tap(ids.undo); check('undo-clear-decision', { index: 0, decision: 'Keep', stars: 5, kept: 1 });
    tap(ids.next); check('next-button', { index: 1, kept: 1 });
    tap(ids.undo); check('undo-keep-button', { index: 0, stars: 5 });
    tap(ids.undo); check('restore-clean-sample', { index: 0 });
  } else if (phase === 'keyboard') {
    select(0); check('initial', { index: 0 });
    key('5', 'y'); check('keyboard-rate-and-keep', { index: 1, kept: 1 });
    key('n'); check('keyboard-reject', { index: 2, kept: 1, rejected: 1 });
    key('u'); check('keyboard-undo', { index: 1, kept: 1 });
    key('ArrowLeft'); check('keyboard-previous', { index: 0, decision: 'Keep', stars: 5, kept: 1 });
    key('ArrowRight'); check('keyboard-next', { index: 1, kept: 1 });
    key('u', 'u'); check('restore-clean-sample', { index: 0 });
  } else if (phase === 'persistence') {
    select(0); check('initial', { index: 0 });
    tap('star-5'); swipe('right'); swipe('left');
    check('review-before-rescan', { index: 2, kept: 1, rejected: 1 });
    directRescan(); inspect('rescan-ready', ids.name);
    check('rescan-keeps-selection-and-totals', { index: 2, kept: 1, rejected: 1 });
    select(0); check('rescan-restores-keep-and-rating', { index: 0, decision: 'Keep', stars: 5, kept: 1, rejected: 1 });
    select(1); check('rescan-restores-reject', { index: 1, decision: 'Reject', kept: 1, rejected: 1 });
    select(0);
  } else {
    select(0); check('export-precondition', { index: 0, decision: 'Keep', stars: 5, kept: 1, rejected: 1 });
    tap(ids.export);
    inspect('export-confirmation-ready', 'export-confirmation');
    // Appetize's scoped iOS inspection returns only the matching container.
    // Read the full hierarchy to assert its separately exposed text elements.
    const { path, nodes } = inspect('export-confirmation');
    const labels = nodes.map(node => node.attributes?.label ?? '').join('\n');
    assert.match(labels, /1 RAW|1 raw|1 file/, 'Confirmation must name the RAW copy count.');
    assert.match(labels, /2.*unreviewed|unreviewed.*2/i, 'Confirmation must disclose skipped unreviewed photos.');
    assert.match(labels, /rating|stars/i, 'Confirmation must explain rating handling.');
    assertExportWorkspace(nodes, path);
    run('screenshot', path.slice(0, -5));
    results.assertions.push({ name: 'export-confirmation', status: 'passed', hierarchy: path }); persist();
    if (values.get('--open-picker')) {
      tap(ids.exportConfirm);
      const picker = inspect('destination-picker');
      run('screenshot', picker.path.slice(0, -5));
      results.assertions.push({ name: 'destination-picker', status: 'captured-for-manual-inspection', hierarchy: picker.path });
    }
  }
  results.status = 'passed';
} catch (error) {
  results.status = 'failed';
  // Avoid child-process error text: it may include session connection details.
  results.error = error instanceof assert.AssertionError ? error.message : 'CLI action failed; inspect ignored local evidence and the active session.';
  try { const failure = inspect('failure'); run('screenshot', failure.path.slice(0, -5)); } catch {}
  console.error(results.error);
  process.exitCode = 1;
} finally {
  if (recording) { try { run('recording', 'stop'); } catch { console.error('Could not stop recording; stop the session promptly.'); process.exitCode = 1; } }
  results.finishedAt = new Date().toISOString(); persist();
}
