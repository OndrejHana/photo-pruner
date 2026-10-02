import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPhotos, applyCommand, applyGuardedCommand, commandForKey, readReview, serializeReview } from './library.ts';
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
  for (const key of ['Y', 'y']) assert.deepEqual(commandForKey(key), { type: 'decision', decision: 'keep' });
  for (const key of ['N', 'n']) assert.deepEqual(commandForKey(key), { type: 'decision', decision: 'reject' });
  for (const key of ['ArrowLeft', 'ArrowUp']) assert.deepEqual(commandForKey(key), { type: 'move', delta: -1 });
  for (const key of ['ArrowRight', 'ArrowDown']) assert.deepEqual(commandForKey(key), { type: 'move', delta: 1 });
  for (const key of ['U', 'u']) assert.deepEqual(commandForKey(key), { type: 'undo' });
  for (const stars of [0, 1, 2, 3, 4, 5]) assert.deepEqual(commandForKey(String(stars)), { type: 'rate', stars });
  for (const key of ['Enter', '9', 'x', '']) assert.equal(commandForKey(key), null);
});
test('clearing a decision preserves stars and selection, and undo restores the decision', () => {
  let state = applyCommand(readReview(null, photos), { type: 'rate', stars: 4 }, photos);
  state = applyCommand(state, { type: 'decision', decision: 'keep' }, photos);
  state = applyCommand(state, { type: 'move', delta: -1 }, photos);
  const kept = state;
  state = applyCommand(state, { type: 'clearDecision' }, photos);
  assert.equal(state.index, 0);
  assert.deepEqual(state.reviews[photos[0].id], { decision: 'unreviewed', stars: 4 });
  assert.strictEqual(applyCommand(state, { type: 'clearDecision' }, photos), state);
  const restored = applyCommand(state, { type: 'undo' }, photos);
  assert.deepEqual(restored.reviews, kept.reviews);
  assert.equal(restored.index, kept.index);
});
test('a stale gesture cannot decide the next photo or a photo selected again later', () => {
  const initial = readReview(null, photos);
  const interaction = { interactionKey: '10', busy: false, writable: true };
  const advanced = applyGuardedCommand(initial, { type: 'decision', decision: 'keep' }, photos, interaction, '10');
  assert.equal(advanced.index, 1);
  const nextInteraction = { ...interaction, interactionKey: '11' };
  assert.strictEqual(applyGuardedCommand(advanced, { type: 'decision', decision: 'reject' }, photos, nextInteraction, '10'), advanced);
  assert.equal(advanced.reviews[photos[1].id], undefined);
  const returned = applyGuardedCommand(advanced, { type: 'move', delta: -1 }, photos, nextInteraction, '11');
  const returnedInteraction = { ...interaction, interactionKey: '12' };
  assert.equal(returned.index, initial.index);
  assert.strictEqual(applyGuardedCommand(returned, { type: 'decision', decision: 'reject' }, photos, returnedInteraction, '10'), returned);
});
test('folder replacement and unlocking invalidate captured gestures, while busy and read-only gates preserve review', () => {
  const state = readReview(null, photos);
  const decision = { type: 'decision', decision: 'keep' } as const;
  const interaction = { interactionKey: '3', busy: false, writable: true };
  assert.strictEqual(applyGuardedCommand(state, decision, photos, interaction, '1'), state);
  assert.strictEqual(applyGuardedCommand(state, decision, photos, { ...interaction, busy: true }, '3'), state);
  assert.strictEqual(applyGuardedCommand(state, { type: 'move', delta: 1 }, photos, { ...interaction, busy: true }), state);
  const readOnly = { ...interaction, writable: false };
  for (const command of [decision, { type: 'rate', stars: 5 }, { type: 'undo' }, { type: 'clearDecision' }] as const) {
    assert.strictEqual(applyGuardedCommand(state, command, photos, readOnly), state);
  }
  assert.equal(applyGuardedCommand(state, { type: 'move', delta: 1 }, photos, readOnly).index, 1);
});
test('boundary navigation and repeated final decisions remain no-ops with the current interaction', () => {
  const last = applyCommand(readReview(null, photos), { type: 'move', delta: 99 }, photos);
  const kept = applyCommand(last, { type: 'decision', decision: 'keep' }, photos);
  const interaction = { interactionKey: '4', busy: false, writable: true };
  assert.strictEqual(applyGuardedCommand(kept, { type: 'move', delta: 1 }, photos, interaction, '4'), kept);
  assert.strictEqual(applyGuardedCommand(kept, { type: 'decision', decision: 'keep' }, photos, interaction, '4'), kept);
});
