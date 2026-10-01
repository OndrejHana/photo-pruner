import assert from 'node:assert/strict';
import test from 'node:test';
import { mountApp } from './app-harness.mjs';

test('rapid keyboard review continues through an unresolved native preview', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  assert.equal(app.previews.length, 1);
  assert.equal(app.swipe().props.canDecide, false);
  assert.equal(app.keyboard().props.enabled, true);

  // One native handler receives a burst before React renders another preview.
  await app.keys('5', 'Y', 'N', '4');
  assert.equal(app.text('selected-name'), 'DSC_0003');
  assert.equal(app.text('stars-value'), '4 / 5 stars');
  assert.equal(app.text('review-summary'), '1 kept · 1 rejected');
  assert.equal(app.swipe().props.canDecide, false);
  assert.equal(app.previews.length, 1, 'review must progress while the original decoder remains pending');

  await app.keys('U', 'U');
  assert.equal(app.text('selected-name'), 'DSC_0002');
  assert.equal(app.text('decision'), 'Unreviewed');
  assert.equal(app.text('stars-value'), '0 / 5 stars');
  assert.equal(app.text('review-summary'), '1 kept · 0 rejected');
});

test('buttons and keys review before Image.onDisplay while touch decisions wait for the current image', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  await app.resolvePreview(0);
  const staleDisplay = app.image().props.onDisplay;
  assert.equal(app.swipe().props.canDecide, false, 'a preview URI alone must not enable swipe decisions');

  await app.keys('5');
  assert.equal(app.text('stars-value'), '5 / 5 stars');
  await app.press('keep');
  assert.equal(app.text('selected-name'), 'DSC_0002');
  await app.press('star-4');
  await app.press('reject');
  assert.equal(app.text('selected-name'), 'DSC_0003');
  assert.equal(app.text('review-summary'), '1 kept · 1 rejected');
  await app.press('undo');
  assert.equal(app.text('selected-name'), 'DSC_0002');
  assert.equal(app.text('decision'), 'Unreviewed');
  assert.equal(app.text('stars-value'), '4 / 5 stars');
  await app.keys('Y');
  assert.equal(app.text('selected-name'), 'DSC_0003');
  assert.equal(app.text('review-summary'), '2 kept · 0 rejected');

  // Finish the obsolete second decode, then display the newest requested image.
  await app.resolvePreview(1);
  await app.resolvePreview(2);
  assert.equal(app.swipe().props.canDecide, false);
  await app.event(staleDisplay);
  assert.equal(app.swipe().props.canDecide, false, 'a prior image callback must not unlock this visit');
  await app.event(app.image().props.onDisplay);
  assert.equal(app.swipe().props.canDecide, true);
});

test('a sheet and its dismissal still block queued keyboard review during preview loading', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  await app.press('help');
  const onDismiss = app.modal().props.onDismiss;
  assert.equal(app.keyboard().props.enabled, false);
  await app.keys('5', 'Y');
  assert.equal(app.text('selected-name'), 'DSC_0001');
  assert.equal(app.text('stars-value'), '0 / 5 stars');
  await app.press('close-sheet');
  assert.equal(app.keyboard().props.enabled, false);
  await app.keys('N');
  assert.equal(app.text('selected-name'), 'DSC_0001');
  await app.event(onDismiss);
  assert.equal(app.keyboard().props.enabled, true);
  await app.keys('5', 'Y');
  assert.equal(app.text('selected-name'), 'DSC_0002');
  assert.equal(app.text('review-summary'), '1 kept · 0 rejected');
});

test('the persistent sidebar stays usable and tracks row selections and keyboard review while decoding', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  assert.equal(app.hasID('photo-sidebar'), true);
  assert.equal(app.byID('photo-0').props.accessibilityState.selected, true);
  await app.press('photo-2');
  assert.equal(app.text('selected-name'), 'DSC_0003');
  assert.equal(app.byID('photo-2').props.accessibilityState.selected, true);
  assert.equal(app.byID('photo-0').props.accessibilityState.selected, false);
  await app.keys('ArrowLeft', '5', 'Y');
  assert.equal(app.text('selected-name'), 'DSC_0003');
  assert.match(app.byID('photo-1').props.accessibilityLabel, /keep, 5 stars/);
  assert.equal(app.hasID('photo-sidebar'), true);
  assert.equal(app.byID('photo-2').props.accessibilityState.selected, true);
  await app.press('photo-1');
  assert.equal(app.text('selected-name'), 'DSC_0002');
  assert.equal(app.text('decision'), 'Keep');
  assert.equal(app.text('stars-value'), '5 / 5 stars');
  await app.keys('N');
  assert.equal(app.text('selected-name'), 'DSC_0003');
  assert.match(app.byID('photo-1').props.accessibilityLabel, /reject, 5 stars/);
  assert.equal(app.swipe().props.canDecide, false);
});

test('App passes the captured swipe item key through the hook and rejects a release after keyboard navigation', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  await app.resolvePreview(0);
  await app.event(app.image().props.onDisplay);
  assert.equal(app.swipe().props.canDecide, true);
  const oldKey = app.swipe().props.itemKey;
  const queuedSwipe = app.swipe().props.onSwipe;

  await app.keys('ArrowRight');
  assert.equal(app.text('selected-name'), 'DSC_0002');
  assert.notEqual(app.swipe().props.itemKey, oldKey);
  // Invoke the App callback directly; native gesture recognition is outside this harness.
  await app.event(() => queuedSwipe('reject', oldKey));
  assert.equal(app.text('selected-name'), 'DSC_0002');
  assert.equal(app.text('decision'), 'Unreviewed');
  assert.equal(app.text('review-summary'), '0 kept · 0 rejected');

  await app.resolvePreview(1);
  await app.event(app.image().props.onDisplay);
  assert.equal(app.swipe().props.canDecide, true);
  const freshKey = app.swipe().props.itemKey;
  await app.event(() => app.swipe().props.onSwipe('keep', freshKey));
  assert.equal(app.text('selected-name'), 'DSC_0003');
  assert.equal(app.text('review-summary'), '1 kept · 0 rejected');
  assert.equal(app.byID('photo-1').props.accessibilityLabel.includes('keep'), true);
});
