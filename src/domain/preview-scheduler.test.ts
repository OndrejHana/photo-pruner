import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_CACHE_COUNT, PreviewScheduler, previewPriorityIndices, type PreviewRequest } from './preview-scheduler.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const request = (index: number, revision = 'scan-1'): PreviewRequest => ({ key: `${revision}:${index}`, photoID: String(index), revision, names: [`${index}.JPG`] });
const windowFor = (index: number, count = 6000, revision = 'scan-1') => previewPriorityIndices(index, count).map(value => request(value, revision));

function fixture() {
  const decodes: { request: PreviewRequest; task: ReturnType<typeof deferred<string>> }[] = [];
  const warms: { uri: string; task: ReturnType<typeof deferred<boolean>> }[] = [];
  let notifications = 0;
  let active = 0;
  let maximumActive = 0;
  const scheduler = new PreviewScheduler(value => {
    const task = deferred<string>();
    decodes.push({ request: value, task });
    active++;
    maximumActive = Math.max(active, maximumActive);
    return task.promise.finally(() => { active--; });
  }, uri => {
    const task = deferred<boolean>();
    warms.push({ uri, task });
    return task.promise;
  }, () => { notifications++; });
  return { scheduler, decodes, warms, notifications: () => notifications, maximumActive: () => maximumActive,
    async decoded(index: number) { decodes[index].task.resolve(`file:///${decodes[index].request.photoID}.jpg`); await tick(); },
    async warmed(index: number, result = true) { warms[index].task.resolve(result); await tick(); },
  };
}

test('preview window prioritizes current and immediate neighbors and clamps folder boundaries', () => {
  assert.deepEqual(previewPriorityIndices(3, 10), [3, 4, 2, 5]);
  assert.deepEqual(previewPriorityIndices(0, 10), [0, 1, 2]);
  assert.deepEqual(previewPriorityIndices(9, 10), [9, 8]);
  assert.deepEqual(previewPriorityIndices(0, 1), [0]);
  assert.deepEqual(previewPriorityIndices(0, 0), []);
  assert.deepEqual(previewPriorityIndices(-1, 10), []);
  assert.deepEqual(previewPriorityIndices(1.5, 10), []);
});

test('current publishes before memory warming, then native preparation and memory warming follow bounded priority', async () => {
  const f = fixture();
  f.scheduler.update('scan-1', windowFor(3));
  assert.deepEqual(f.decodes.map(value => value.request.photoID), ['3']);
  assert.equal(f.warms.length, 0);
  await f.decoded(0);
  assert.equal(f.scheduler.get('scan-1:3')?.uri, 'file:///3.jpg');
  assert.equal(f.scheduler.get('scan-1:3')?.memoryReady, false);
  assert.deepEqual(f.warms.map(value => value.uri), ['file:///3.jpg']);
  await f.warmed(0);
  assert.equal(f.scheduler.get('scan-1:3')?.memoryReady, true);
  await f.decoded(1);
  await f.warmed(1);
  await f.decoded(2);
  await f.warmed(2);
  await f.decoded(3);
  await f.warmed(3);
  assert.deepEqual(f.decodes.map(value => value.request.photoID), ['3', '4', '2', '5']);
  assert.deepEqual(f.warms.map(value => value.uri), ['file:///3.jpg', 'file:///4.jpg', 'file:///2.jpg', 'file:///5.jpg']);
  assert.equal(f.maximumActive(), 1);
});

test('5,000 navigation updates replace unsent work without building a native backlog', async () => {
  const f = fixture();
  f.scheduler.update('scan-1', windowFor(0));
  for (let index = 1; index <= 5000; index++) f.scheduler.update('scan-1', windowFor(index));
  assert.equal(f.decodes.length, 1);
  assert.equal(f.warms.length, 0);
  await f.decoded(0);
  assert.deepEqual(f.decodes.map(value => value.request.photoID), ['0', '5000']);
  assert.equal(f.scheduler.get('scan-1:5000'), null); // The old photo never supplies the current preview.
  assert.equal(f.warms.length, 0); // A stale URI is not warmed ahead of the current photo.
  await f.decoded(1);
  assert.equal(f.decodes[2].request.photoID, '5001');
  assert.equal(f.warms[0].uri, 'file:///5000.jpg');
  assert.equal(f.maximumActive(), 1);
});

test('cached neighboring URI is available immediately on selection without another native round trip', async () => {
  const f = fixture();
  f.scheduler.update('scan-1', windowFor(0));
  await f.decoded(0);
  await f.warmed(0);
  await f.decoded(1);
  await f.warmed(1);
  f.scheduler.update('scan-1', windowFor(1));
  assert.equal(f.scheduler.get('scan-1:1')?.uri, 'file:///1.jpg');
  assert.equal(f.scheduler.get('scan-1:1')?.memoryReady, true);
  assert.equal(f.decodes.filter(value => value.request.photoID === '1').length, 1);
});

test('cold current takes priority after at most one already-running speculative decode', async () => {
  const f = fixture();
  f.scheduler.update('scan-1', windowFor(0));
  await f.decoded(0); // Native starts speculative item 1.
  f.scheduler.update('scan-1', windowFor(40));
  assert.equal(f.decodes.length, 2);
  await f.decoded(1);
  assert.deepEqual(f.decodes.map(value => value.request.photoID), ['0', '1', '40']);
  assert.equal(f.warms.length, 1); // The earlier active current warm may finish; no speculative warm starts.
  await f.decoded(2);
  assert.equal(f.decodes[3].request.photoID, '41');
});

test('revision changes suppress old decode and warm completions and prepare the new current first', async () => {
  const f = fixture();
  f.scheduler.update('scan-1', windowFor(0));
  await f.decoded(0);
  const notifications = f.notifications();
  f.scheduler.update('scan-2', windowFor(0, 6000, 'scan-2'));
  await f.warmed(0);
  await f.decoded(1);
  assert.equal(f.scheduler.get('scan-1:0'), null);
  assert.equal(f.scheduler.get('scan-1:1'), null);
  assert.equal(f.notifications(), notifications);
  assert.equal(f.decodes[2].request.revision, 'scan-2');
  await f.decoded(2);
  assert.equal(f.scheduler.get('scan-2:0')?.uri, 'file:///0.jpg');
});

test('speculative failures are cached without replacing current success; explicit retry invalidates the old attempt', async () => {
  const f = fixture();
  f.scheduler.update('scan-1', windowFor(0));
  await f.decoded(0);
  const failure = new Error('No readable RAW preview');
  f.decodes[1].task.reject(failure);
  await tick();
  assert.equal(f.scheduler.get('scan-1:0')?.error, null);
  assert.strictEqual(f.scheduler.get('scan-1:1')?.error, failure);
  f.scheduler.update('scan-1', windowFor(1));
  assert.equal(f.decodes.filter(value => value.request.photoID === '1').length, 1);
  f.scheduler.retry('scan-1:1');
  assert.equal(f.scheduler.get('scan-1:1'), null);
  await f.decoded(2); // Item 2 was already active; retry suppresses its obsolete completion.
  assert.equal(f.scheduler.get('scan-1:2'), null);
  assert.equal(f.decodes[3].request.photoID, '1');
  await f.decoded(3);
  assert.equal(f.scheduler.get('scan-1:1')?.error, null);
});

test('retrying an active foreground decode suppresses its old error and waits for the fresh attempt', async () => {
  const f = fixture();
  f.scheduler.update('scan-1', [request(0)]);
  f.scheduler.retry('scan-1:0');
  f.decodes[0].task.reject(new Error('Old permission failure'));
  await tick();
  assert.equal(f.scheduler.get('scan-1:0'), null);
  assert.equal(f.notifications(), 0);
  assert.equal(f.decodes.length, 2);
  await f.decoded(1);
  assert.equal(f.scheduler.get('scan-1:0')?.uri, 'file:///0.jpg');
});

test('clearing preview work suppresses an old failure and permits a fresh request after the decoder frees up', async () => {
  const f = fixture();
  f.scheduler.update('scan-1', [request(0)]);
  f.scheduler.clear();
  f.decodes[0].task.reject(new Error('Obsolete decode failure'));
  await tick();
  assert.equal(f.scheduler.get('scan-1:0'), null);
  assert.equal(f.notifications(), 0);
  assert.equal(f.decodes.length, 1);
  f.scheduler.update('scan-1', [request(3)]);
  await f.decoded(1);
  assert.equal(f.scheduler.get('scan-1:3')?.uri, 'file:///3.jpg');
});

test('busy pause stops unsent decoding and warming while retaining already prepared current results', async () => {
  const f = fixture();
  f.scheduler.update('scan-1', windowFor(1));
  await f.decoded(0);
  f.scheduler.pause();
  const notifications = f.notifications();
  await f.decoded(1);
  await f.warmed(0);
  assert.equal(f.decodes.length, 2);
  assert.equal(f.warms.length, 1);
  assert.equal(f.notifications(), notifications);
  assert.equal(f.scheduler.get('scan-1:1')?.memoryReady, true);
  f.scheduler.update('scan-1', windowFor(1));
  assert.equal(f.decodes[2].request.photoID, '0');
  assert.equal(f.warms[1].uri, 'file:///2.jpg');
});

test('failed optional memory warming does not become a visible preview error or spin on repeated updates', async () => {
  const f = fixture();
  f.scheduler.update('scan-1', [request(0)]);
  await f.decoded(0);
  await f.warmed(0, false);
  for (let i = 0; i < 20; i++) f.scheduler.update('scan-1', [request(0)]);
  assert.equal(f.scheduler.get('scan-1:0')?.uri, 'file:///0.jpg');
  assert.equal(f.scheduler.get('scan-1:0')?.error, null);
  assert.equal(f.scheduler.get('scan-1:0')?.memoryReady, false);
  assert.equal(f.decodes.length, 1);
  assert.equal(f.warms.length, 1);
});

test('URI history remains bounded while recently prepared photos remain reusable', async () => {
  const f = fixture();
  for (let index = 0; index < 30; index++) {
    f.scheduler.update('scan-1', [request(index)]);
    await f.decoded(index);
  }
  const retained = Array.from({ length: 30 }, (_, index) => f.scheduler.get(`scan-1:${index}`)).filter(Boolean);
  assert.equal(retained.length, PREVIEW_CACHE_COUNT);
  assert.equal(f.scheduler.get('scan-1:0'), null);
  assert.equal(f.scheduler.get('scan-1:29')?.uri, 'file:///29.jpg');
  assert.equal(f.warms.length, 1); // One unresolved warm never grows a loader backlog.
  f.scheduler.update('scan-1', [request(0)]);
  assert.equal(f.decodes.length, 31);
});
