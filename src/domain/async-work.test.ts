import test from 'node:test';
import assert from 'node:assert/strict';
import { CoalescingWriter, type SaveStatus } from './async-work.ts';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test('rapid autosave coalesces before serialization and never overlaps writes', async () => {
  const gate = deferred();
  const writes: number[] = [];
  const states: SaveStatus[] = [];
  const writer = new CoalescingWriter<number>(async value => { writes.push(value); if (value === 1) await gate.promise; }, status => states.push(status));
  writer.schedule(1);
  const flush = writer.flush();
  for (let value = 2; value <= 5000; value++) writer.schedule(value);
  assert.deepEqual(writes, [1]);
  gate.resolve();
  await flush;
  assert.deepEqual(writes, [1, 5000]);
  assert.equal(states.at(-1)?.state, 'saved');
});

test('failed save blocks flush, retains the newest data and can be retried', async () => {
  const gate = deferred();
  let fail = true;
  const writes: number[] = [];
  const writer = new CoalescingWriter<number>(async value => { writes.push(value); await gate.promise; if (fail) throw new Error('disk full'); }, () => {});
  writer.schedule(1);
  const flush = writer.flush();
  writer.schedule(2);
  gate.resolve();
  await assert.rejects(flush, /disk full/);
  fail = false;
  await writer.flush();
  assert.deepEqual(writes, [1, 2]);
});
