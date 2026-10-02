import test from 'node:test';
import assert from 'node:assert/strict';
import { CoalescingWriter } from './async-work.ts';
import { afterReviewSaved, clearWorkspaceIssue, reportWorkspaceIssue, workspaceError, workspaceIssue, type WorkspaceIssues } from './workspace-errors.ts';

function saving(initialIssues: WorkspaceIssues = []) {
  let failing = true;
  let issues = initialIssues;
  const attempts: number[] = [];
  const writer = new CoalescingWriter<number>(async value => {
    attempts.push(value);
    if (failing) throw new Error('Disk full');
  }, status => {
    if (status.state === 'saved') issues = clearWorkspaceIssue(issues, 'save');
    else if (status.state === 'failed') issues = reportWorkspaceIssue(issues, workspaceIssue(status.error, 'save'));
  }, 60_000);
  return {
    writer, attempts,
    recover: () => { failing = false; },
    issues: () => issues,
    record: (issue: ReturnType<typeof workspaceIssue>) => { issues = reportWorkspaceIssue(issues, issue); },
    clearSaveError: () => { issues = clearWorkspaceIssue(issues, 'save'); },
  };
}

for (const source of ['folder', 'export'] as const) {
  test(`failed flush blocks ${source}, retains save provenance, and retry clears its error`, async () => {
    const fixture = saving();
    fixture.writer.schedule(1);
    let operationCalls = 0;
    await assert.rejects(afterReviewSaved(fixture.writer, () => { operationCalls++; }), error => {
      const issue = workspaceIssue(error, source);
      assert.equal(issue.source, 'save');
      fixture.record(issue);
      return true;
    });
    assert.equal(operationCalls, 0);
    assert.equal(workspaceError(fixture.issues()), 'Could not save review: Disk full');

    fixture.recover();
    await afterReviewSaved(fixture.writer, () => {}); // The same flush path used by Retry save.
    fixture.clearSaveError();
    assert.equal(workspaceError(fixture.issues()), null);
    assert.deepEqual(fixture.attempts, [1, 1]);
    await afterReviewSaved(fixture.writer, () => { operationCalls++; });
    assert.equal(operationCalls, 1);
  });

  test(`${source} errors after a successful flush remain unrelated to saving and survive retry`, async () => {
    const fixture = saving();
    fixture.recover();
    fixture.writer.schedule(2);
    const failure = new Error(`${source} access denied`);
    await assert.rejects(afterReviewSaved(fixture.writer, async () => { throw failure; }), error => {
      assert.strictEqual(error, failure);
      const issue = workspaceIssue(error, source);
      assert.equal(issue.source, source);
      fixture.record(issue);
      return true;
    });
    await afterReviewSaved(fixture.writer, () => {});
    fixture.clearSaveError();
    assert.equal(workspaceError(fixture.issues()), `${source} access denied`);
    assert.deepEqual(fixture.attempts, [2]);
  });
}

test('successful later autosave clears the save failure and restores an unrelated read-only review error', async () => {
  const reviewError = workspaceIssue(new Error('Saved review is unreadable. Editing is disabled.'), 'review');
  const fixture = saving([reviewError]);
  fixture.writer.schedule(1);
  await assert.rejects(fixture.writer.flush(), /Disk full/);
  assert.equal(fixture.issues().length, 2);
  assert.equal(workspaceError(fixture.issues()), 'Could not save review: Disk full');

  fixture.recover();
  fixture.writer.schedule(3);
  await fixture.writer.flush();
  assert.deepEqual(fixture.attempts, [1, 3]);
  assert.deepEqual(fixture.issues(), [reviewError]);
  assert.equal(workspaceError(fixture.issues()), reviewError.message);
});

test('recovery uses provenance even when an unrelated error text looks like a save failure', async () => {
  const unrelated = workspaceIssue(new Error('Could not save review: corrupt imported review document'), 'review');
  const fixture = saving([unrelated]);
  fixture.writer.schedule(1);
  await assert.rejects(fixture.writer.flush());
  fixture.recover();
  await afterReviewSaved(fixture.writer, () => {});
  fixture.clearSaveError();
  assert.deepEqual(fixture.issues(), [unrelated]);
});
