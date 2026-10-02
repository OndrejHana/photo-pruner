import assert from 'node:assert/strict';
import test from 'node:test';
import { mountApp } from './app-harness.mjs';

function assertDecorative(snapshot) {
  assert.ok(snapshot, 'a warmed neighbor supplies a decorative snapshot');
  assert.equal(snapshot.props.accessible, false);
  assert.equal(snapshot.props.onDisplay, undefined);
  assert.equal(snapshot.props.onError, undefined);
}

test('foreground publishing does not await warming; cached neighbors still await their actual display', async t => {
  const warms = [];
  const app = await mountApp({ prefetch: uri => new Promise(resolve => warms.push({ uri, resolve })) });
  t.after(() => app.unmount());
  assert.equal(app.cacheConfigurations.length, 1);
  assert.ok(app.cacheConfigurations[0].maxMemoryCount <= 8);
  assert.ok(app.cacheConfigurations[0].maxMemoryCost <= 96 * 1024 * 1024);
  await app.resolvePreviewFor('DSC_0001.JPG');
  const oldDisplay = app.image().props.onDisplay;
  assert.equal(app.image().props.source, 'file:///test-preview-0.jpg');
  assert.equal(warms.length, 1);
  assert.equal(app.swipe().props.canDecide, false);
  await app.resolvePreviewFor('DSC_0002.JPG');
  assert.equal(app.swipe().props.nextSnapshot, undefined, 'native URI alone is not a warmed underlay');
  await app.event(() => warms[0].resolve(true));
  await app.event(() => warms[1].resolve(true));
  assertDecorative(app.swipe().props.nextSnapshot);
  await app.event(oldDisplay);
  assert.equal(app.swipe().props.canDecide, true);
  const requests = app.previews.length;
  await app.keys('ArrowRight');
  assert.equal(app.text('selected-name'), 'DSC_0002');
  assert.equal(app.image().props.source, 'file:///test-preview-1.jpg');
  assert.equal(app.previews.length, requests, 'selection reuses the prepared neighbor URI');
  assert.equal(app.swipe().props.canDecide, false, 'warming must not replace actual Image.onDisplay');
  await app.event(oldDisplay);
  assert.equal(app.swipe().props.canDecide, false);
  await app.event(app.image().props.onDisplay);
  assert.equal(app.swipe().props.canDecide, true);
  assertDecorative(app.swipe().props.previousSnapshot);
  assert.equal(app.prefetches.every(call => call.options.cachePolicy === 'memory'), true);
});

test('a pending speculative decode cannot stall keyboard decisions and obsolete demand follows the newest selection', async t => {
  const app = await mountApp({ files: ['A.JPG', 'B.JPG', 'C.JPG', 'D.JPG', 'E.JPG'] });
  t.after(() => app.unmount());
  await app.resolvePreviewFor('A.JPG');
  assert.deepEqual(app.previews.map(request => request.names), [['A.JPG'], ['B.JPG']]);
  await app.keys('Y', 'N', 'Y');
  assert.equal(app.text('selected-name'), 'D');
  assert.equal(app.text('review-summary'), '2 kept · 1 rejected');
  assert.equal(app.previews.length, 2, 'native decoding remains serial while review progresses');
  await app.resolvePreviewFor('B.JPG');
  assert.deepEqual(app.previews[2].names, ['D.JPG'], 'foreground D supersedes unsent C');
  await app.resolvePreviewFor('D.JPG');
  assert.equal(app.image().props.source, 'file:///test-preview-2.jpg');
  assert.equal(app.swipe().props.canDecide, false);
});

test('a failed speculative neighbor stays quiet until selected and remains reviewable', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  await app.resolvePreviewFor('DSC_0001.JPG');
  await app.event(app.image().props.onDisplay);
  await app.rejectPreviewFor('DSC_0002.JPG', 'Unsupported image');
  assert.equal(app.hasID('preview-error'), false);
  assert.equal(app.text('preview-status'), 'Preview ready');
  await app.keys('ArrowRight');
  assert.equal(app.text('preview-status'), 'Preview unavailable');
  assert.equal(app.text('preview-error'), 'Unsupported image');
  assert.equal(app.swipe().props.canDecide, true);
  await app.keys('5', 'Y');
  assert.equal(app.text('selected-name'), 'DSC_0003');
  assert.equal(app.text('review-summary'), '1 kept · 0 rejected');
  assert.match(app.byID('photo-1').props.accessibilityLabel, /keep, 5 stars/);
});

test('inline export freezes the visible workspace and pauses new previews until dismissed', async t => {
  const app = await mountApp({ files: ['A.NEF', 'A.JPG', 'B.NEF', 'B.JPG', 'C.NEF', 'C.JPG'] });
  t.after(() => app.unmount());
  await app.resolvePreviewFor('A.JPG');
  await app.keys('Y');
  await app.press('export-keepers');
  assert.equal(app.hasID('export-confirmation'), true);
  assert.equal(app.hasID('photo-sidebar'), true);
  assert.equal(app.text('selected-name'), 'B');
  assert.equal(app.keyboard().props.enabled, false);
  assert.equal(app.swipe().props.enabled, false);
  for (const id of ['keep', 'reject', 'photo-0', 'star-5', 'open-folder', 'refresh-folder']) {
    assert.equal(app.byID(id).props.disabled, true, `${id} is frozen during confirmation`);
  }
  await app.resolvePreviewFor('B.JPG');
  assert.equal(app.previews.length, 2, 'finishing an in-flight decode must not start another during export');
  await app.keys('N', '5');
  assert.equal(app.text('review-summary'), '1 kept · 0 rejected');
  await app.press('export-cancel-confirmation');
  assert.equal(app.keyboard().props.enabled, true);
  assert.equal(app.text('selected-name'), 'B');
  assert.equal(app.hasID('photo-preview'), true);
  assert.deepEqual(app.previews[2].names, ['C.JPG', 'C.NEF']);
});
