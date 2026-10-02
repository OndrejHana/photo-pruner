import assert from 'node:assert/strict';
import test from 'node:test';
import { mountApp } from './app-harness.mjs';

const reviewed = app => app.byID('review-progress').props.accessibilityValue.now;

test('tapping the selected rating clears only stars and feedback Undo restores them', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  await app.press('star-4');
  await app.press('star-4');
  assert.equal(app.text('stars-value'), '0 / 5 stars');
  assert.equal(app.text('action-feedback'), 'Stars cleared');
  assert.equal(app.text('selected-name'), 'DSC_0001');
  assert.equal(app.text('decision'), 'Unreviewed');
  assert.equal(reviewed(app), 0);
  await app.press('feedback-undo');
  assert.equal(app.text('stars-value'), '4 / 5 stars');
  assert.equal(app.text('selected-name'), 'DSC_0001');
  assert.equal(app.text('decision'), 'Unreviewed');
  await app.press('clear-stars');
  assert.equal(app.text('stars-value'), '0 / 5 stars');
  await app.keys('4', '4');
  assert.equal(app.text('stars-value'), '4 / 5 stars', 'hardware ratings set an explicit value');
  await app.keys('0');
  assert.equal(app.text('stars-value'), '0 / 5 stars');
});

test('completion preserves browsing and review; Undo and clearing a decision reopen progress', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  await app.keys('Y', 'N', 'Y');
  assert.equal(app.hasID('review-complete'), true);
  assert.match(app.text('review-complete'), /All 3 reviewed/);
  assert.equal(app.text('review-summary'), '2 kept · 1 rejected');
  assert.deepEqual(app.byID('review-progress').props.accessibilityValue,
    { min: 0, max: 3, now: 3, text: '3 of 3 reviewed' });
  assert.equal(app.hasID('photo-sidebar'), true);
  assert.equal(app.keyboard().props.enabled, true);
  assert.equal(app.byID('keep').props.disabled, false);
  assert.equal(app.byID('photo-0').props.disabled, false);
  assert.equal(app.hasID('close-sheet'), false, 'completion must not open a modal');
  await app.press('feedback-undo');
  assert.equal(app.hasID('review-complete'), false);
  assert.equal(reviewed(app), 2);
  assert.equal(app.text('decision'), 'Unreviewed');
  await app.keys('Y');
  assert.equal(app.hasID('review-complete'), true);
  await app.press('photo-0');
  assert.equal(app.text('decision'), 'Keep');
  assert.equal(app.hasID('photo-decision'), true);
  assert.equal(app.byID('photo-decision').props.pointerEvents, 'none');
  assert.equal(app.byID('photo-decision').props.accessibilityElementsHidden, true);
  await app.press('clear-decision');
  assert.equal(app.hasID('review-complete'), false);
  assert.equal(app.hasID('photo-decision'), false);
  assert.equal(reviewed(app), 2);
  assert.equal(app.text('selected-name'), 'DSC_0001');
});

test('an all-rejected shoot completes without enabling keeper export', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  await app.keys('N', 'N', 'N');
  assert.match(app.text('review-complete'), /No keepers yet/);
  assert.equal(app.byID('export-keepers').props.disabled, true);
  assert.equal(app.byID('reject').props.disabled, false);
  await app.press('photo-0');
  await app.keys('Y');
  assert.equal(reviewed(app), 3);
  assert.equal(app.byID('export-keepers').props.disabled, false);
  assert.match(app.text('review-complete'), /1 keeper/);
});

test('Undo requests a reversed decision entry while rating-only Undo does not replay a photo transition', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  const initial = app.swipe().props.entry;
  await app.keys('5', 'U');
  assert.equal(app.swipe().props.entry, initial, 'rating-only Undo does not replay a photo transition');
  await app.keys('Y', 'U');
  const keepEntry = app.swipe().props.entry;
  assert.equal(keepEntry.from, 'right');
  assert.equal(app.text('selected-name'), 'DSC_0001');
  await app.keys('N', 'U');
  const rejectEntry = app.swipe().props.entry;
  assert.equal(rejectEntry.from, 'left');
  assert.notEqual(rejectEntry.id, keepEntry.id, 'each reversed decision has its own presentation identity');
  await app.keys('4', 'U');
  assert.equal(app.swipe().props.entry, initial);
  assert.equal(app.text('review-summary'), '0 kept · 0 rejected');
  await app.press('photo-2');
  await app.keys('Y', 'U');
  assert.equal(app.swipe().props.entry, initial, 'Undo on the same final photo needs no arrival animation');
});

test('narrow completion stays inline and Photos dismissal preserves the keyboard guard', async t => {
  const app = await mountApp({ dimensions: { width: 1024, height: 1366, scale: 2, fontScale: 1 } });
  t.after(() => app.unmount());
  await app.keys('Y', 'N', 'Y');
  assert.equal(app.hasID('review-complete'), true);
  assert.equal(app.hasID('photo-sidebar'), false);
  assert.equal(app.hasID('close-sheet'), false);
  assert.equal(app.byID('keep').props.disabled, false);
  await app.press('browse-photos');
  const dismiss = app.modal().props.onDismiss;
  assert.equal(app.keyboard().props.enabled, false);
  await app.press('photo-0');
  assert.equal(app.text('selected-name'), 'DSC_0001');
  assert.equal(app.hasID('review-complete'), true);
  assert.equal(app.keyboard().props.enabled, false, 'selection must wait for the sheet to finish dismissing');
  await app.keys('N');
  assert.equal(app.text('decision'), 'Keep');
  await app.event(dismiss);
  assert.equal(app.keyboard().props.enabled, true);
  await app.press('clear-decision');
  assert.equal(app.hasID('review-complete'), false);
  assert.equal(reviewed(app), 2);
});

test('two captured star taps before rendering toggle the current rating twice', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  const tapFive = app.byID('star-5').props.onPress;
  await app.event(() => { tapFive(); tapFive(); });
  assert.equal(app.text('stars-value'), '0 / 5 stars');
  assert.equal(app.text('action-feedback'), 'Stars cleared', 'feedback reports the committed rating');
  assert.equal(app.text('selected-name'), 'DSC_0001');
  assert.equal(app.text('decision'), 'Unreviewed');
  await app.press('feedback-undo');
  assert.equal(app.text('stars-value'), '5 / 5 stars', 'both taps entered distinct rating history');
});

test('a captured star tap resolves the latest selection and rating after batched keyboard commands', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  await app.keys('5');
  const tapFiveOnRatedPhoto = app.byID('star-5').props.onPress;
  const receiver = app.keyboard().props.onCommand;
  await app.event(() => {
    receiver({ nativeEvent: { key: 'Y' } });
    tapFiveOnRatedPhoto();
  });
  assert.equal(app.text('selected-name'), 'DSC_0002');
  assert.equal(app.text('stars-value'), '5 / 5 stars', 'B starts unrated despite the captured A handler');
  assert.equal(app.text('action-feedback'), '5 stars');
  assert.equal(app.text('review-summary'), '1 kept · 0 rejected');
  const tapFour = app.byID('star-4').props.onPress;
  await app.event(() => {
    receiver({ nativeEvent: { key: 'ArrowRight' } });
    receiver({ nativeEvent: { key: '4' } });
    tapFour();
  });
  assert.equal(app.text('selected-name'), 'DSC_0003');
  assert.equal(app.text('stars-value'), '0 / 5 stars', 'toggle sees the immediately preceding keyboard rating');
  assert.equal(app.text('action-feedback'), 'Stars cleared');
  assert.equal(app.text('decision'), 'Unreviewed');
  await app.press('photo-1');
  assert.equal(app.text('stars-value'), '5 / 5 stars', 'the previous photo rating remains intact');
});

test('consecutive same-text Undo receipts renew feedback for the full lifetime', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = await mountApp();
  t.after(() => app.unmount());
  await app.keys('5', 'Y', 'N');
  await app.press('undo');
  assert.equal(app.text('action-feedback'), 'Last change undone');
  await app.event(() => t.mock.timers.tick(4000));
  await app.press('feedback-undo');
  assert.equal(app.text('action-feedback'), 'Last change undone');
  await app.event(() => t.mock.timers.tick(1500));
  assert.equal(app.hasID('feedback-undo'), true, 'the original receipt timer must not hide the renewed Undo');
  await app.event(() => t.mock.timers.tick(3499));
  assert.equal(app.hasID('action-feedback'), true);
  await app.event(() => t.mock.timers.tick(1));
  assert.equal(app.hasID('action-feedback'), false, 'feedback expires five seconds after the latest accepted action');
  assert.equal(app.byID('undo').props.disabled, false, 'persistent Undo remains usable after feedback expires');
});

test('Rescan clears feedback from the prior workspace even when the folder revision is unchanged', async t => {
  const app = await mountApp();
  t.after(() => app.unmount());
  await app.keys('Y');
  assert.equal(app.text('action-feedback'), 'Kept DSC_0001');
  await app.press('refresh-folder');
  assert.equal(app.hasID('action-feedback'), false);
  assert.equal(app.hasID('feedback-undo'), false);
  assert.equal(app.byID('keep').props.disabled, false);
});
