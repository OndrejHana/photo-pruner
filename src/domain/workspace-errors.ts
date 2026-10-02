export type ErrorSource = 'save' | 'folder' | 'review' | 'export' | 'general';
export type WorkspaceIssue = { source: ErrorSource; message: string };
export type WorkspaceIssues = readonly WorkspaceIssue[];

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/^UnexpectedException: /, '').replace(/ \(at ExpoModulesCore\/[^)]+\)$/, '');

class ReviewSaveFailure extends Error {
  constructor(error: unknown) {
    super(errorMessage(error), { cause: error });
    this.name = 'ReviewSaveFailure';
  }
}

/** Only the flush is a save failure; the following operation keeps its own error source. */
export async function afterReviewSaved<T>(writer: { flush(): Promise<void> }, operation: () => T | Promise<T>): Promise<T> {
  try { await writer.flush(); }
  catch (error) { throw new ReviewSaveFailure(error); }
  return operation();
}

export function workspaceIssue(error: unknown, source: ErrorSource): WorkspaceIssue {
  const provenance = error instanceof ReviewSaveFailure ? 'save' : source;
  const message = errorMessage(error);
  return { source: provenance, message: provenance === 'save' ? `Could not save review: ${message}` : message };
}

/** Keep unrelated errors so resolving a save failure can reveal the earlier folder/review error. */
export function reportWorkspaceIssue(issues: WorkspaceIssues, issue: WorkspaceIssue): WorkspaceIssues {
  return [...issues.filter(previous => previous.source !== issue.source), issue];
}

export function clearWorkspaceIssue(issues: WorkspaceIssues, source: ErrorSource): WorkspaceIssues {
  return issues.some(issue => issue.source === source) ? issues.filter(issue => issue.source !== source) : issues;
}

/** Starting another operation does not resolve a failed save or an unreadable saved review. */
export function clearTransientWorkspaceIssues(issues: WorkspaceIssues): WorkspaceIssues {
  const retained = issues.filter(issue => issue.source === 'save' || issue.source === 'review');
  return retained.length === issues.length ? issues : retained;
}

export const dismissWorkspaceIssue = (issues: WorkspaceIssues): WorkspaceIssues => issues.length ? issues.slice(0, -1) : issues;

export const workspaceError = (issues: WorkspaceIssues): string | null => issues.at(-1)?.message ?? null;
