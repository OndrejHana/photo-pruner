import assert from 'node:assert/strict';
import test from 'node:test';
import { mountApp } from './app-harness.mjs';

for (const operation of ['refresh-folder', 'export-keepers']) {
  test(`Retry save clears the visible save failure raised while ${operation} flushes pending review`, async t => {
    let failing = true;
    let attempts = 0;
    let rescans = 0;
    let savedReview = null;
    const exports = [];
    const app = await mountApp({
      files: ['DSC_0001.NEF', 'DSC_0001.JPG', 'DSC_0002.NEF', 'DSC_0002.JPG', 'DSC_0003.NEF', 'DSC_0003.JPG'],
      native: {
        loadReview: async () => savedReview,
        saveReview: async (_, json) => {
          attempts += 1;
          if (failing) throw new Error('Disk full');
          savedReview = json;
        },
        exportKeepers: async (revision, names) => {
          exports.push({ revision, names });
          return { name: 'Keepers', uri: 'file:///test-keepers', count: names.length, bytes: 10 };
        },
      },
    });
    t.after(() => app.unmount());
    app.native.refreshFolder = async () => { rescans += 1; return app.folder; };

    await app.keys('Y');
    await app.press(operation);
    assert.ok(attempts > 0);
    assert.equal(rescans, 0, 'an unsaved review must prevent the folder operation');
    assert.equal(exports.length, 0);
    assert.equal(app.hasID('export-confirmation'), false, 'an unsaved review must not reach export confirmation');
    assert.equal(app.text('app-error'), 'Could not save review: Disk full');
    assert.match(app.text('save-status'), /Save failed/);
    assert.equal(app.text('selected-name'), 'DSC_0002');

    failing = false;
    await app.press('retry-save');
    assert.ok(attempts >= 2);
    assert.match(app.text('save-status'), /Saved on this iPad/);
    assert.equal(app.hasID('app-error'), false, 'successful retry must also clear the visible workspace error');
    assert.equal(app.hasID('retry-save'), false);
    assert.equal(app.text('review-summary'), '1 kept · 0 rejected');

    await app.press(operation);
    if (operation === 'refresh-folder') {
      assert.equal(rescans, 1, 'rescan may run only after the saved review recovers');
      assert.equal(app.text('review-summary'), '1 kept · 0 rejected');
    } else {
      assert.equal(app.hasID('export-confirmation'), true, 'export may reach confirmation after saving recovers');
      assert.equal(exports.length, 0, 'confirmation must precede native export');
      await app.press('export-choose-destination');
      assert.deepEqual(exports, [{ revision: 'scan-1', names: ['DSC_0001.NEF'] }]);
      assert.equal(app.hasID('export-result'), true);
    }
  });
}
