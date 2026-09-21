import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPhotos, applyCommand, commandForKey, readReview, serializeReview } from './library.ts';
const files = (...names: string[]) => names.map(name => ({ name, size: 10 }));
const photos = groupPhotos(files('DSC_0001.NEF', 'DSC_0001.JPG', 'DSC_0002.JPG', 'DSC_0003.NEF'));

test('pairs mixed-case RAW + JPEG and uses JPEG preview', () => {
  const result = groupPhotos(files('DSC_0001.NEF', 'dsc_0001.jPg', 'DSC_0001.xmp'));
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'RAW + JPEG');
  assert.equal(result[0].previewName, 'dsc_0001.jPg');
  assert.equal(result[0].files.length, 2);
});
test('keeps directories separate, preserves orphans, sorts numbers naturally', () => {
  const result = groupPhotos(files('A/shot2.NEF', 'B/shot2.JPG', 'A/shot10.JPG', 'A/shot1.JPG', 'readme.txt'));
  assert.deepEqual(result.map(p => p.name), ['A/shot1', 'A/shot2', 'A/shot10', 'B/shot2']);
});
test('multiple companions retain all originals and grouping is deterministic', () => {
  const input = files('same.CR3', 'same.DNG', 'same.JPG', 'same.JPEG');
  assert.deepEqual(groupPhotos(input), groupPhotos(input.slice().reverse()));
  assert.equal(groupPhotos(input)[0].files.length, 4);
});
test('decision applies to pair, advances once; rating stays; undo restores prior selection', () => {
  let state = { index: 0, reviews: {}, undo: [] } as ReturnType<typeof readReview>;
  state = applyCommand(state, { type: 'rate', stars: 5 }, photos);
  assert.equal(state.index, 0);
  state = applyCommand(state, { type: 'decision', decision: 'keep' }, photos);
  assert.equal(state.index, 1);
  assert.deepEqual(state.reviews[photos[0].id], { decision: 'keep', stars: 5 });
  state = applyCommand(state, { type: 'undo' }, photos);
  assert.equal(state.index, 0);
  assert.deepEqual(state.reviews[photos[0].id], { decision: 'unreviewed', stars: 5 });
});
test('navigation clamps at both ends and empty folders are safe', () => {
  const state = readReview(null, photos);
  assert.equal(applyCommand(state, { type: 'move', delta: -1 }, photos).index, 0);
  assert.equal(applyCommand(state, { type: 'move', delta: 99 }, photos).index, 2);
  assert.strictEqual(applyCommand(state, { type: 'rate', stars: 5 }, []), state);
});
test('ratings and selection survive serialization and folder reorder', () => {
  const state = applyCommand(readReview(null, photos), { type: 'decision', decision: 'reject' }, photos);
  const reordered = photos.slice().reverse();
  const restored = readReview(serializeReview(state, photos), reordered);
  assert.equal(reordered[restored.index].id, photos[state.index].id);
  assert.deepEqual(restored.reviews, state.reviews);
});
test('corrupt or future review formats report errors', () => {
  assert.throws(() => readReview('{', photos));
  assert.throws(() => readReview('{"version":2,"reviews":{}}', photos));
  assert.throws(() => readReview('{"version":1,"reviews":{"a":{"stars":6,"decision":"keep"}}}', photos));
});
test('all requested shortcuts map to commands; unrelated keys are ignored', () => {
  for (const key of ['Y', 'n', 'ArrowLeft', 'ArrowRight', '1', '2', '3', '4', '5', '0', 'u']) assert.ok(commandForKey(key));
  for (const key of ['Enter', '9', 'x', '']) assert.equal(commandForKey(key), null);
});
