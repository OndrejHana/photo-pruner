import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Native, { type ExportProgress, type ExportResult, type Folder } from '../modules/photo-pruner-native';
import { CoalescingWriter, LatestTask, type SaveStatus } from './domain/async-work';
import { applyCommand, groupPhotos, planKeeperExport, previewCandidates, readReview, serializeReview, type Command, type ExportPlan, type Photo, type ReviewState } from './domain/library';

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/^UnexpectedException: /, '').replace(/ \(at ExpoModulesCore\/[^)]+\)$/, '');
type Save = { folderID: string; review: ReviewState; photos: Photo[] };
type Preview = { key: string; uri: string | null; error: string | null };
type PreviewRequest = { revision: string; names: string[] };

export function useWorkspace() {
  const [folder, setFolder] = useState<Folder | null>(null);
  const [review, setReview] = useState<ReviewState>({ index: 0, reviews: {}, undo: [] });
  const [busy, setBusy] = useState(true);
  const [writable, setWritable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'saved' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [exportPlan, setExportPlan] = useState<ExportPlan | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const current = useRef({ folder, review, photos: [] as Photo[], busy: true, writable: true });
  const exportStarted = useRef(false);
  const writer = useMemo(() => new CoalescingWriter<Save>(value => Native.saveReview(value.folderID, serializeReview(value.review, value.photos)), setSaveStatus), []);
  const decoder = useMemo(() => new LatestTask<PreviewRequest, string>(value => Native.previewCandidates(value.revision, value.names)), []);
  const photos = useMemo(() => groupPhotos(folder?.files ?? []), [folder]);
  const selected = photos[review.index];
  const previewKey = `${folder?.revision}:${selected?.id}`;

  const lock = useCallback((value: boolean) => { current.current.busy = value; setBusy(value); }, []);
  const acceptFolder = useCallback(async (next: Folder | null) => {
    if (!next) return;
    const photos = groupPhotos(next.files);
    let restored = readReview(null, photos);
    let loadError: string | null = null;
    try { restored = readReview(await Native.loadReview(next.id), photos); }
    catch (error) { loadError = `Saved review could not be loaded. Editing and export are disabled to preserve it. ${errorMessage(error)}`; }
    current.current = { folder: next, review: restored, photos, busy: true, writable: !loadError };
    setFolder(next); setReview(restored); setWritable(!loadError); setError(loadError);
    setSaveStatus({ state: 'saved' }); setExportResult(null);
  }, []);

  const load = useCallback(async (operation: () => Promise<Folder | null>) => {
    if (current.current.busy) return;
    lock(true); setError(null);
    decoder.clear();
    try {
      await writer.flush(); // Never activate another folder while the current review is unsaved.
      await acceptFolder(await operation());
    } catch (error) { setError(errorMessage(error)); }
    finally { lock(false); }
  }, [acceptFolder, decoder, lock, writer]);

  useEffect(() => {
    let mounted = true;
    Native.restoreFolder().then(next => { if (mounted) return acceptFolder(next); }).catch(error => {
      if (mounted) setError(`Could not reopen the previous folder. Choose it again. ${errorMessage(error)}`);
    }).finally(() => { if (mounted) lock(false); });
    return () => { mounted = false; decoder.clear(); void writer.flush().catch(() => {}); };
  }, [acceptFolder, decoder, lock, writer]);

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

  useEffect(() => {
    if (!selected || !folder || busy) { decoder.clear(); return; }
    decoder.request({ revision: folder.revision, names: previewCandidates(selected) }, result => {
      setPreview('value' in result ? { key: previewKey, uri: result.value, error: null } : { key: previewKey, uri: null, error: errorMessage(result.error) });
    });
    return () => decoder.clear();
  }, [selected, folder, previewKey, decoder, busy]);

  const changeReview = useCallback((next: ReviewState) => {
    const state = current.current;
    if (!state.folder || state.review === next) return;
    state.review = next;
    setReview(next);
    writer.schedule({ folderID: state.folder.id, review: next, photos: state.photos });
  }, [writer]);
  const execute = useCallback((command: Command) => {
    const state = current.current;
    if (state.busy || !state.folder || (!state.writable && command.type !== 'move')) return;
    const next = applyCommand(state.review, command, state.photos);
    if (state.writable) changeReview(next);
    else { state.review = next; setReview(next); }
  }, [changeReview]);
  const select = useCallback((index: number) => {
    const state = current.current;
    if (state.busy || !Number.isInteger(index) || index < 0 || index >= state.photos.length || index === state.review.index) return;
    const next = { ...state.review, index };
    if (state.writable) changeReview(next);
    else { state.review = next; setReview(next); }
  }, [changeReview]);

  const prepareExport = useCallback(async () => {
    const state = current.current;
    if (state.busy || !state.folder || !state.writable) return;
    lock(true); setError(null); setExportResult(null);
    try {
      await writer.flush();
      const plan = planKeeperExport(state.photos, state.review.reviews);
      if (!plan.names.length) throw new Error('Keep at least one RAW photo before exporting. JPEG-only items cannot be exported.');
      setExportPlan(plan);
    } catch (error) { setError(errorMessage(error)); lock(false); }
  }, [lock, writer]);
  const dismissExport = useCallback(() => { setExportPlan(null); lock(false); }, [lock]);
  const confirmExport = useCallback(async () => {
    const target = current.current.folder;
    if (!target || !exportPlan || exportStarted.current) return;
    exportStarted.current = true;
    setExporting(true); setProgress(null); setExportPlan(null);
    try { setExportResult(await Native.exportKeepers(target.revision, exportPlan.names)); }
    catch (error) { setError(errorMessage(error)); }
    finally { exportStarted.current = false; setExporting(false); lock(false); }
  }, [exportPlan, lock]);
  const cancelExport = useCallback(async () => {
    try { await Native.cancelExport(); }
    catch (error) { setError(errorMessage(error)); }
  }, []);
  const retrySave = useCallback(async () => {
    try { await writer.flush(); setError(null); }
    catch (error) { setError(`Could not save review: ${errorMessage(error)}`); }
  }, [writer]);

  return { folder, photos, review, selected, busy, writable, error, setError, saveStatus, preview: preview?.key === previewKey ? preview : null,
    load, execute, select, retrySave, exportPlan, exporting, progress, exportResult, prepareExport, dismissExport, confirmExport, cancelExport };
}
