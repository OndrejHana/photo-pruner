import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { AppState } from 'react-native';
import { Image } from 'expo-image';
import Native, { type ExportProgress, type ExportResult, type Folder } from '../modules/photo-pruner-native';
import { CoalescingWriter, type SaveStatus } from './domain/async-work';
import { applyGuardedCommand, groupPhotos, planKeeperExport, previewCandidates, readReview, reviewFor, serializeReview, type Command, type ExportPlan, type Photo, type ReviewState } from './domain/library';
import { PREVIEW_CACHE_COUNT, PREVIEW_MEMORY_BYTES, PreviewScheduler, previewPriorityIndices } from './domain/preview-scheduler';
import { afterReviewSaved, clearTransientWorkspaceIssues, clearWorkspaceIssue, dismissWorkspaceIssue, errorMessage, reportWorkspaceIssue, workspaceError, workspaceIssue, type ErrorSource, type WorkspaceIssues } from './domain/workspace-errors';

export { errorMessage } from './domain/workspace-errors';
type Save = { folderID: string; review: ReviewState; photos: Photo[] };
export type AdjacentPreview = { photoID: string; key: string; uri: string; offset: -1 | 1 | 2; memoryReady: boolean };
export type CommandReceipt = { photoName: string; stars: number; atEnd: boolean; fromIndex: number; toIndex: number; undoneDecision?: 'keep' | 'reject' };

export function useWorkspace() {
  const [folder, setFolder] = useState<Folder | null>(null);
  const [review, setReview] = useState<ReviewState>({ index: 0, reviews: {}, undo: [] });
  const [busy, setBusy] = useState(true);
  const [writable, setWritable] = useState(true);
  const [issues, setIssues] = useState<WorkspaceIssues>([]);
  const error = workspaceError(issues);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'saved' });
  const [, refreshPreviews] = useState(0);
  const [interactionKey, setInteractionKey] = useState('0');
  const [exportPlan, setExportPlan] = useState<ExportPlan | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const current = useRef({ folder, review, photos: [] as Photo[], busy: true, writable: true, interactionKey: '0' });
  const interactionSerial = useRef(0);
  const preparedExport = useRef<ExportPlan | null>(null);
  const exportStarted = useRef(false);
  const reportError = useCallback((error: unknown, source: ErrorSource) => {
    setIssues(previous => reportWorkspaceIssue(previous, workspaceIssue(error, source)));
  }, []);
  const clearSaveError = useCallback(() => setIssues(previous => clearWorkspaceIssue(previous, 'save')), []);
  const clearTransientErrors = useCallback(() => setIssues(clearTransientWorkspaceIssues), []);
  const setError = useCallback((value: SetStateAction<string | null>) => {
    setIssues(previous => {
      const message = typeof value === 'function' ? value(workspaceError(previous)) : value;
      if (message === null) return dismissWorkspaceIssue(previous);
      return message === workspaceError(previous) ? previous : reportWorkspaceIssue(previous, { source: 'general', message });
    });
  }, []);
  const writer = useMemo(() => new CoalescingWriter<Save>(value => Native.saveReview(value.folderID, serializeReview(value.review, value.photos)), status => {
    setSaveStatus(status);
    if (status.state === 'saved') clearSaveError();
    else if (status.state === 'failed') reportError(status.error, 'save');
  }), [clearSaveError, reportError]);
  const decoder = useMemo(() => new PreviewScheduler(
    value => Native.previewCandidates(value.revision, value.names),
    uri => Image.prefetch(uri, { cachePolicy: 'memory' }),
    () => refreshPreviews(value => value + 1),
  ), []);
  const photos = useMemo(() => groupPhotos(folder?.files ?? []), [folder]);
  const selected = photos[review.index];
  const previewKey = `${folder?.revision}:${selected?.id}`;
  const preparedPreview = decoder.get(previewKey);
  const preview = preparedPreview ? { key: preparedPreview.key, uri: preparedPreview.uri, memoryReady: preparedPreview.memoryReady,
    error: preparedPreview.uri === null ? errorMessage(preparedPreview.error) : null } : null;
  const adjacentPreviews: AdjacentPreview[] = [];
  if (folder) for (const offset of [1, -1, 2] as const) {
    const photo = photos[review.index + offset];
    if (!photo) continue;
    const result = decoder.get(`${folder.revision}:${photo.id}`);
    if (result?.uri) adjacentPreviews.push({ photoID: photo.id, key: result.key, uri: result.uri, offset, memoryReady: result.memoryReady });
  }

  const preparePreviews = useCallback(() => {
    const state = current.current;
    const folder = state.folder;
    if (state.busy || !folder) { decoder.pause(); return; }
    decoder.update(folder.revision, previewPriorityIndices(state.review.index, state.photos.length).map(index => {
      const photo = state.photos[index];
      return { key: `${folder.revision}:${photo.id}`, photoID: photo.id, revision: folder.revision, names: previewCandidates(photo) };
    }));
  }, [decoder]);

  const invalidateInteraction = useCallback(() => {
    const key = String(++interactionSerial.current);
    current.current.interactionKey = key;
    setInteractionKey(key);
  }, []);
  const lock = useCallback((value: boolean) => {
    if (current.current.busy !== value) invalidateInteraction();
    current.current.busy = value;
    // Pause before any queued preview can submit to the serial native Files worker.
    if (value) decoder.pause();
    else preparePreviews();
    setBusy(value);
  }, [decoder, invalidateInteraction, preparePreviews]);
  const acceptFolder = useCallback(async (next: Folder | null) => {
    if (!next) return;
    const photos = groupPhotos(next.files);
    let restored = readReview(null, photos);
    let loadError: string | null = null;
    try { restored = readReview(await Native.loadReview(next.id), photos); }
    catch (error) { loadError = `Saved review could not be loaded. Editing and export are disabled to preserve it. ${errorMessage(error)}`; }
    current.current = { folder: next, review: restored, photos, busy: true, writable: !loadError, interactionKey: current.current.interactionKey };
    decoder.resetRevision(next.revision);
    invalidateInteraction();
    preparedExport.current = null;
    setFolder(next); setReview(restored); setWritable(!loadError);
    setIssues(loadError ? [{ source: 'review', message: loadError }] : []);
    setSaveStatus({ state: 'saved' }); setExportResult(null);
  }, [decoder, invalidateInteraction]);

  const load = useCallback(async (operation: () => Promise<Folder | null>) => {
    if (current.current.busy) return;
    lock(true); clearTransientErrors();
    try {
      // Never activate another folder while the current review is unsaved.
      await afterReviewSaved(writer, async () => acceptFolder(await operation()));
    } catch (error) { reportError(error, 'folder'); }
    finally { lock(false); }
  }, [acceptFolder, clearTransientErrors, lock, reportError, writer]);

  useEffect(() => {
    Image.configureCache({ maxMemoryCount: PREVIEW_CACHE_COUNT, maxMemoryCost: PREVIEW_MEMORY_BYTES });
    let mounted = true;
    Native.restoreFolder().then(next => { if (mounted) return acceptFolder(next); }).catch(error => {
      if (mounted) reportError(`Could not reopen the previous folder. Choose it again. ${errorMessage(error)}`, 'folder');
    }).finally(() => { if (mounted) lock(false); });
    return () => { mounted = false; decoder.clear(); void writer.flush().catch(() => {}); };
  }, [acceptFolder, decoder, lock, reportError, writer]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') void writer.flush().catch(() => {});
    });
    return () => subscription.remove();
  }, [writer]);
  useEffect(() => {
    const subscription = Native.addListener('onExportProgress', setProgress);
    return () => subscription.remove();
  }, []);

  useEffect(() => { preparePreviews(); }, [folder, review.index, busy, preparePreviews]);

  const changeReview = useCallback((next: ReviewState) => {
    const state = current.current;
    if (!state.folder || state.review === next) return false;
    state.review = next;
    // Replace unsent neighbor demand synchronously, including rapid hardware commands before render.
    preparePreviews();
    invalidateInteraction();
    setReview(next);
    if (state.writable) writer.schedule({ folderID: state.folder.id, review: next, photos: state.photos });
    return true;
  }, [invalidateInteraction, preparePreviews, writer]);
  const execute = useCallback((command: Command, expectedInteractionKey?: string): CommandReceipt | null => {
    const state = current.current;
    const photo = state.photos[state.review.index];
    if (!state.folder || !photo) return null;
    const fromIndex = state.review.index;
    let undoneDecision: 'keep' | 'reject' | undefined;
    if (command.type === 'undo') {
      const entry = state.review.undo.at(-1);
      if (entry) {
        const decision = reviewFor(state.review.reviews, entry.id).decision;
        if (decision !== entry.previous.decision && decision !== 'unreviewed') undoneDecision = decision;
      }
    }
    const next = applyGuardedCommand(state.review, command, state.photos, state, expectedInteractionKey);
    const receipt: CommandReceipt = { photoName: photo.name, stars: reviewFor(next.reviews, photo.id).stars, atEnd: fromIndex === state.photos.length - 1, fromIndex, toIndex: next.index,
      ...(undoneDecision ? { undoneDecision } : {}) };
    return changeReview(next) ? receipt : null;
  }, [changeReview]);
  const select = useCallback((index: number, expectedInteractionKey?: string): boolean => {
    const state = current.current;
    if (!Number.isInteger(index) || index < 0 || index >= state.photos.length) return false;
    return !!execute({ type: 'move', delta: index - state.review.index }, expectedInteractionKey);
  }, [execute]);
  const retryPreview = useCallback(() => {
    const state = current.current;
    if (state.busy || !state.folder || !state.photos[state.review.index]) return;
    decoder.retry(`${state.folder.revision}:${state.photos[state.review.index].id}`);
    invalidateInteraction();
  }, [decoder, invalidateInteraction]);

  const prepareExport = useCallback(async () => {
    const state = current.current;
    if (state.busy || !state.folder || !state.writable) return;
    lock(true); clearTransientErrors(); setExportResult(null);
    try {
      const plan = await afterReviewSaved(writer, () => {
        const plan = planKeeperExport(state.photos, state.review.reviews);
        if (!plan.names.length) throw new Error('Keep at least one RAW photo before exporting. JPEG-only items cannot be exported.');
        return plan;
      });
      preparedExport.current = plan;
      setExportPlan(plan);
    } catch (error) { reportError(error, 'export'); lock(false); }
  }, [clearTransientErrors, lock, reportError, writer]);
  const dismissExport = useCallback(() => {
    if (!preparedExport.current || exportStarted.current) return;
    preparedExport.current = null;
    setExportPlan(null); lock(false);
  }, [lock]);
  const confirmExport = useCallback(async () => {
    const target = current.current.folder;
    const plan = preparedExport.current;
    if (!target || !plan || exportStarted.current) return;
    exportStarted.current = true;
    preparedExport.current = null;
    setExporting(true); setProgress(null); setExportPlan(null);
    try { setExportResult(await Native.exportKeepers(target.revision, plan.names)); }
    catch (error) { reportError(error, 'export'); }
    finally { exportStarted.current = false; setExporting(false); lock(false); }
  }, [lock, reportError]);
  const cancelExport = useCallback(async () => {
    try { await Native.cancelExport(); }
    catch (error) { reportError(error, 'export'); }
  }, [reportError]);
  const retrySave = useCallback(async () => {
    try {
      await afterReviewSaved(writer, () => {});
      clearSaveError();
    }
    catch (error) { reportError(error, 'save'); }
  }, [clearSaveError, reportError, writer]);
  const dismissExportResult = useCallback(() => setExportResult(null), []);

  return { folder, photos, review, selected, busy, writable, interactionKey, error, setError, saveStatus, preview, adjacentPreviews,
    load, execute, select, retrySave, retryPreview, exportPlan, exporting, progress, exportResult, prepareExport, dismissExport, dismissExportResult, confirmExport, cancelExport };
}
