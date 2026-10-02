import assert from 'node:assert/strict';
import test from 'node:test';
import { mountApp } from './app-harness.mjs';

test('cancelling Open folder preserves the corrupt-review warning and read-only review', async t => {
  const app = await mountApp({ native: {
    loadReview: async () => { throw new Error('Corrupt review'); },
    openFolder: async () => null,
  } });
  t.after(() => app.unmount());
  const warning = app.text('app-error');
  assert.match(warning, /Saved review could not be loaded.*Corrupt review/);
  assert.match(app.text('save-status'), /Review read-only/);

  await app.press('open-folder');
  assert.equal(app.text('app-error'), warning);
  assert.match(app.text('save-status'), /Review read-only/);
  assert.equal(app.byID('keep').props.disabled, true);
  assert.equal(app.swipe().props.canDecide, false);
  await app.keys('5', 'Y', 'N');
  assert.equal(app.text('selected-name'), 'DSC_0001');
  assert.equal(app.text('stars-value'), '0 / 5 stars');
  assert.equal(app.text('review-summary'), '0 kept · 0 rejected');
  assert.equal(app.saves.length, 0);
});

test('dismissing a folder error reveals the underlying corrupt-review warning', async t => {
  const app = await mountApp({ native: {
    loadReview: async () => { throw new Error('Corrupt review'); },
    openFolder: async () => { throw new Error('Folder access denied'); },
  } });
  t.after(() => app.unmount());
  const warning = app.text('app-error');
  await app.press('open-folder');
  assert.equal(app.text('app-error'), 'Folder access denied');
  assert.match(app.text('save-status'), /Review read-only/);
  await app.press('dismiss-error');
  assert.equal(app.text('app-error'), warning);
  assert.equal(app.byID('keep').props.disabled, true);
  assert.equal(app.keyboard().props.enabled, true, 'browsing remains available in a read-only folder');
});
