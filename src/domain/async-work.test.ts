import test from 'node:test';
import assert from 'node:assert/strict';
import { CoalescingWriter, LatestTask, type SaveStatus } from './async-work.ts';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

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

test('latest preview skips thousands of intermediate requests and hides obsolete results', async () => {
  const gate = deferred();
  const calls: number[] = [];
  const results: unknown[] = [];
  const decoder = new LatestTask<number, number>(async value => { calls.push(value); await gate.promise; return value; });
  decoder.request(0, result => results.push(result));
  for (let value = 1; value <= 5000; value++) decoder.request(value, result => results.push(result));
  gate.resolve();
  await tick();
  assert.deepEqual(calls, [0, 5000]);
  assert.deepEqual(results, [{ value: 5000 }]);
});

test('clearing preview work suppresses old errors and continues after decoder failures', async () => {
  const gate = deferred();
  const received: unknown[] = [];
  const decoder = new LatestTask<number, number>(async value => { await gate.promise; if (value === 1) throw new Error('invalid'); return value; });
  decoder.request(1, result => received.push(result));
  decoder.request(2, result => received.push(result));
  decoder.clear();
  gate.resolve();
  await tick();
  assert.equal(received.length, 0);
  decoder.request(3, result => received.push(result));
  await tick();
  assert.deepEqual(received, [{ value: 3 }]);
});
