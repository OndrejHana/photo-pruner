import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, groupPhotos, planKeeperExport, previewCandidates, readReview, reviewFor, serializeReview } from './library.ts';

const files = (...names: string[]) => names.map(name => ({ name, size: 100 }));
test('exports all RAW companions of explicit keeps, but no JPEG, rejected or merely starred files', () => {
  const photos = groupPhotos(files('one.ORF', 'one.JPG', 'one.DNG', 'two.ORF', 'three.ORF', 'four.JPG'));
  const reviews = { one: { decision: 'keep', stars: 0 }, two: { decision: 'reject', stars: 5 }, three: { decision: 'unreviewed', stars: 5 }, four: { decision: 'keep', stars: 4 } } as const;
  assert.deepEqual(planKeeperExport(photos, reviews), { names: ['one.DNG', 'one.ORF'], totalBytes: 200, unreviewed: 1, keptWithoutRaw: 1 });
  assert.deepEqual(planKeeperExport([], {}), { names: [], totalBytes: 0, unreviewed: 0, keptWithoutRaw: 0 });
});
test('export refuses ambiguous destination names and traversal, including Unicode normalization collisions', () => {
  for (const names of [['a.ORF', 'A.orf'], ['é.ORF', 'e\u0301.orf'], ['folder/a.ORF'], ['a\\b.ORF']]) {
    const photos = groupPhotos(files(...names));
    const reviews = Object.fromEntries(photos.map(p => [p.id, { decision: 'keep' as const, stars: 0 }]));
    assert.throws(() => planKeeperExport(photos, reviews));
  }
});
test('export rejects invalid or overflowing byte totals', () => {
  for (const size of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => planKeeperExport(groupPhotos([{ name: 'a.ORF', size }]), { a: { decision: 'keep', stars: 0 } }));
  }
  const photos = groupPhotos([{ name: 'a.ORF', size: Number.MAX_SAFE_INTEGER }, { name: 'b.ORF', size: 1 }]);
  assert.throws(() => planKeeperExport(photos, { a: { decision: 'keep', stars: 0 }, b: { decision: 'keep', stars: 0 } }));
});
test('preview fallback order prefers JPEG, then rendered alternatives, then the standalone RAW', () => {
  const [photo] = groupPhotos(files('a.ORF', 'a.TIF', 'a.JPG'));
  assert.deepEqual(previewCandidates(photo), ['a.JPG', 'a.TIF', 'a.ORF']);
  assert.deepEqual(previewCandidates(groupPhotos(files('b.ORF'))[0]), ['b.ORF']);
});
test('filenames matching object prototype keys remain independent review items through save and restore', () => {
  const photos = groupPhotos(files('__proto__.ORF', 'constructor.ORF', 'toString.ORF'));
  let state = readReview(null, photos);
  for (const photo of photos) assert.deepEqual(reviewFor(state.reviews, photo.id), { decision: 'unreviewed', stars: 0 });
  for (let i = 0; i < photos.length; i++) state = applyCommand(state, { type: 'decision', decision: 'keep' }, photos);
  const restored = readReview(serializeReview(state, photos), photos);
  assert.deepEqual(restored.reviews, state.reviews);
  assert.equal(Object.getPrototypeOf(restored.reviews), Object.prototype);
  assert.equal(planKeeperExport(photos, restored.reviews).names.length, 3);
});
test('boundary navigation and repeated ratings are no-ops; invalid ratings cannot corrupt saved state', () => {
  const photos = groupPhotos(files('a.ORF'));
  const state = readReview(null, photos);
  for (const command of [{ type: 'move', delta: -1 }, { type: 'move', delta: Infinity }, { type: 'rate', stars: 0 }, { type: 'rate', stars: NaN }] as const) assert.equal(applyCommand(state, command, photos), state);
  assert.throws(() => readReview('{"version":1,"reviews":[]}', photos));
  assert.throws(() => readReview('{"version":1,"reviews":{},"selectedID":3}', photos));
});
