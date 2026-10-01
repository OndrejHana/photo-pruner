import test from 'node:test';
import assert from 'node:assert/strict';
import { canCommitSwipe, classifySwipe, swipeAllowed, swipeAxis, swipeThreshold,
  type SwipeCommit, type SwipeCommitState, type SwipeRelease } from './swipe.ts';

const release = (overrides: Partial<SwipeRelease> = {}): SwipeRelease => ({
  axis: 'horizontal', x: 100, y: 0, velocityX: 0, velocityY: 0, width: 800, height: 600, ...overrides,
});

test('direction locks only after clear travel, including vertical intention', () => {
  assert.equal(swipeAxis(12, 0), null);
  assert.equal(swipeAxis(40, 35), null);
  assert.equal(swipeAxis(27, 20), 'horizontal');
  assert.equal(swipeAxis(20, -27), 'vertical');
  assert.equal(swipeAxis(NaN, 40), null);
});

test('distance thresholds scale to the preview while staying reachable on iPad', () => {
  assert.equal(swipeThreshold(240), 56);
  assert.equal(swipeThreshold(500), 70);
  assert.equal(swipeThreshold(1200), 96);
  assert.equal(classifySwipe(release({ x: 95 })), null);
  assert.equal(classifySwipe(release({ x: 96 })), 'keep');
  assert.equal(classifySwipe(release({ width: 400, x: -56 })), 'reject');
});

test('four directions match the approved decision and browsing semantics', () => {
  assert.equal(classifySwipe(release()), 'keep');
  assert.equal(classifySwipe(release({ x: -100 })), 'reject');
  assert.equal(classifySwipe(release({ axis: 'vertical', x: 0, y: -100 })), 'next');
  assert.equal(classifySwipe(release({ axis: 'vertical', x: 0, y: 100 })), 'previous');
});

test('a quick flick needs minimum travel, same-direction velocity and a clear velocity axis', () => {
  assert.equal(classifySwipe(release({ x: 31, velocityX: 2000 })), null);
  assert.equal(classifySwipe(release({ x: 32, velocityX: 950 })), 'keep');
  assert.equal(classifySwipe(release({ x: 40, velocityX: 949 })), null);
  assert.equal(classifySwipe(release({ x: 40, velocityX: -1500 })), null);
  assert.equal(classifySwipe(release({ x: 40, velocityX: 1000, velocityY: 1000 })), null);
  assert.equal(classifySwipe(release({ axis: 'vertical', x: 0, y: -32, velocityY: -950 })), 'next');
});

test('diagonal releases and turns away from the locked axis cannot make decisions', () => {
  assert.equal(classifySwipe(release({ axis: null, x: 150, y: 150 })), null);
  assert.equal(classifySwipe(release({ x: 120, y: 110 })), null);
  assert.equal(classifySwipe(release({ x: 40, y: -180, velocityX: 1500 })), null);
  assert.equal(classifySwipe(release({ x: 125, y: 100 })), 'keep');
});

test('invalid layout or gesture measurements cannot commit', () => {
  for (const overrides of [{ width: 0 }, { height: -1 }, { x: Infinity }, { y: NaN }, { velocityX: NaN }, { width: Infinity }]) {
    assert.equal(classifySwipe(release(overrides)), null);
  }
});

test('boundaries block browsing while the final photo still accepts keep/reject', () => {
  assert.equal(swipeAllowed('previous', true, false, true), false);
  assert.equal(swipeAllowed('next', true, true, false), false);
  assert.equal(swipeAllowed('keep', true, false, false), true);
  assert.equal(swipeAllowed('reject', true, false, false), true);
  assert.equal(swipeAllowed('keep', false, true, true), false);
  assert.equal(swipeAllowed('reject', false, true, true), false);
  assert.equal(swipeAllowed('next', false, true, true), true);
  assert.equal(swipeAllowed('previous', false, true, true), true);
});

const pending = (overrides: Partial<SwipeCommit> = {}): SwipeCommit => ({
  action: 'keep', itemKey: 'shoot/photo-1', epoch: 7, token: 2, ...overrides,
});
const current = (overrides: Partial<SwipeCommitState> = {}): SwipeCommitState => ({
  itemKey: 'shoot/photo-1', epoch: 7, lastCommit: { epoch: 7, token: 1 }, mounted: true, enabled: true,
  canDecide: true, canPrevious: true, canNext: true, ...overrides,
});

test('queued releases reject a changed item or an invalidated generation, even after returning to the same photo', () => {
  const release = pending();
  assert.equal(canCommitSwipe(release, current()), true);
  assert.equal(canCommitSwipe(release, current({ itemKey: 'shoot/photo-2' })), false);
  assert.equal(canCommitSwipe(release, current({ epoch: 8 })), false);
  // Navigation followed by Undo can restore the name while the original release remains stale.
  assert.equal(canCommitSwipe(release, current({ itemKey: release.itemKey, epoch: 9 })), false);
});

test('a delivered release cannot commit twice, while a new gesture can review the final photo again', () => {
  const release = pending();
  const state = current({ canNext: false });
  assert.equal(canCommitSwipe(release, state), true);
  const afterCommit = { ...state, lastCommit: { epoch: release.epoch, token: release.token } };
  assert.equal(canCommitSwipe(release, afterCommit), false);
  assert.equal(canCommitSwipe(pending({ token: 3 }), afterCommit), true);
  assert.equal(canCommitSwipe(release, { ...afterCommit, lastCommit: { epoch: release.epoch, token: 3 } }), false);
  assert.equal(canCommitSwipe(pending({ epoch: 8 }), { ...afterCommit, epoch: 8 }), true);
});

test('unmounting or disabling input after release blocks queued decisions and navigation', () => {
  for (const action of ['keep', 'reject', 'next', 'previous'] as const) {
    assert.equal(canCommitSwipe(pending({ action }), current({ mounted: false })), false);
    assert.equal(canCommitSwipe(pending({ action }), current({ enabled: false })), false);
  }
});

test('latest decision readiness blocks queued decisions while preserving browsing as a preview finishes', () => {
  const loading = current({ canDecide: false });
  assert.equal(canCommitSwipe(pending({ action: 'keep' }), loading), false);
  assert.equal(canCommitSwipe(pending({ action: 'reject' }), loading), false);
  const browse = pending({ action: 'next' });
  assert.equal(canCommitSwipe(browse, loading), true);
  assert.equal(canCommitSwipe(browse, { ...loading, canDecide: true }), true);
  assert.equal(canCommitSwipe(pending({ action: 'previous' }), loading), true);
  assert.equal(canCommitSwipe(pending(), { ...loading, canDecide: true }), true);
});

test('a queued release observes current browsing boundaries without blocking decisions on the final photo', () => {
  assert.equal(canCommitSwipe(pending({ action: 'previous' }), current({ canPrevious: false })), false);
  assert.equal(canCommitSwipe(pending({ action: 'next' }), current({ canNext: false })), false);
  assert.equal(canCommitSwipe(pending({ action: 'keep' }), current({ canNext: false })), true);
  assert.equal(canCommitSwipe(pending({ action: 'reject' }), current({ canNext: false })), true);
});
