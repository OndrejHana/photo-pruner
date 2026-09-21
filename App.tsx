import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Native, { PhotoPrunerNativeView, type Folder } from './modules/photo-pruner-native';
import { applyCommand, commandForKey, EMPTY_REVIEW, groupPhotos, readReview, serializeReview, type Command, type ReviewState } from './src/domain/library';
import { UI_REVISION } from './src/revision';

function Button({ label, onPress, id, active = false, disabled = false }: { label: string; onPress: () => void; id: string; active?: boolean; disabled?: boolean }) {
  return <Pressable testID={id} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, active && styles.activeButton, (disabled || pressed) && { opacity: 0.45 }]}><Text style={[styles.buttonText, active && { color: '#0c1610' }]}>{label}</Text></Pressable>;
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/^UnexpectedException: /, '').replace(/ \(at ExpoModulesCore\/[^)]+\)$/, '');

function Workspace() {
  const [folder, setFolder] = useState<Folder | null>(null);
  const [review, setReview] = useState<ReviewState>({ index: 0, reviews: {}, undo: [] });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState('Saved on this iPad');
  const [previewResult, setPreviewResult] = useState<{ key: string; uri: string | null; error: string | null; ms: number | null } | null>(null);
  const [lastKey, setLastKey] = useState('—');
  const current = useRef({ folder, review, busy, writable: true });
  const saveQueue = useRef(Promise.resolve());
  const saveVersion = useRef(0);
  const listRef = useRef<FlatList>(null);
  const photos = useMemo(() => groupPhotos(folder?.files ?? []), [folder]);
  const photosRef = useRef(photos);
  const selected = photos[review.index];
  const rating = selected ? review.reviews[selected.id] ?? EMPTY_REVIEW : EMPTY_REVIEW;
  const previewKey = `${folder?.id}:${folder?.scanMs}:${selected?.id}`;
  const preview = previewResult?.key === previewKey ? previewResult.uri : null;
  const previewError = previewResult?.key === previewKey ? previewResult.error : null;
  const previewMs = previewResult?.key === previewKey ? previewResult.ms : null;

  const persist = useCallback((next: ReviewState) => {
    const target = current.current.folder;
    if (!target || !current.current.writable) return;
    const json = serializeReview(next, photosRef.current);
    const version = ++saveVersion.current;
    setSaveStatus('Saving…');
    saveQueue.current = saveQueue.current.then(() => Native.saveReview(target.id, json)).then(() => {
      if (saveVersion.current === version) setSaveStatus('Saved on this iPad');
    }).catch(error => {
      if (saveVersion.current === version) {
        setSaveStatus('Save failed');
        setError(`Could not save review: ${message(error)}`);
      }
    });
  }, []);

  const acceptFolder = useCallback(async (next: Folder | null) => {
    if (!next) return;
    await saveQueue.current;
    const nextPhotos = groupPhotos(next.files);
    photosRef.current = nextPhotos;
    let restored = readReview(null, nextPhotos);
    let loadError: string | null = null;
    try { restored = readReview(await Native.loadReview(next.id), nextPhotos); }
    catch (error) { loadError = `Saved review could not be loaded; saving is disabled to preserve it. ${message(error)}`; }
    current.current = { folder: next, review: restored, busy: true, writable: !loadError };
    setFolder(next);
    setReview(restored);
    setError(loadError);
    setSaveStatus(loadError ? 'Review read-only' : 'Saved on this iPad');
    console.info('[PhotoPruner] folder', JSON.stringify({ name: next.name, photos: nextPhotos.length, files: next.files.length, scanMs: next.scanMs }));
  }, []);

  const load = useCallback(async (operation: () => Promise<Folder | null>) => {
    if (current.current.busy) return;
    current.current.busy = true;
    setBusy(true);
    setError(null);
    try { await acceptFolder(await operation()); }
    catch (error) { setError(message(error)); }
    finally { current.current.busy = false; setBusy(false); }
  }, [acceptFolder]);

  useEffect(() => {
    let mounted = true;
    Native.restoreFolder().then(next => { if (mounted) return acceptFolder(next); }).catch(error => {
      if (mounted) setError(`Could not reopen the previous folder. Choose it again. ${message(error)}`);
    }).finally(() => { if (mounted) { current.current.busy = false; setBusy(false); } });
    return () => { mounted = false; };
  }, [acceptFolder]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) return;
    const started = performance.now();
    Native.preview(selected.previewName).then(uri => {
      if (cancelled) return;
      setPreviewResult({ key: previewKey, uri, ms: Math.round(performance.now() - started), error: null });
      const next = photos[review.index + 1];
      if (next) void Native.preview(next.previewName).then(uri => Image.prefetch(uri)).catch(() => {});
    }).catch(error => { if (!cancelled) setPreviewResult({ key: previewKey, uri: null, error: message(error), ms: null }); });
    return () => { cancelled = true; };
  }, [selected, previewKey, review.index, photos]);

  const execute = useCallback((command: Command) => {
    const state = current.current;
    if (state.busy || !state.folder) return;
    const next = applyCommand(state.review, command, photosRef.current);
    current.current.review = next;
    setReview(next);
    persist(next);
  }, [persist]);
  const select = (index: number) => {
    if (current.current.busy) return;
    const next = { ...current.current.review, index };
    current.current.review = next;
    setReview(next);
    persist(next);
  };
  useEffect(() => {
    if (photos.length) listRef.current?.scrollToIndex({ index: review.index, animated: false, viewPosition: 0.5 });
  }, [review.index, photos.length]);

  const summary = photos.reduce((acc, photo) => {
    const decision = review.reviews[photo.id]?.decision;
    if (decision === 'keep') acc.keep++;
    if (decision === 'reject') acc.reject++;
    return acc;
  }, { keep: 0, reject: 0 });

  return <SafeAreaView style={styles.screen}>
    <StatusBar style="light" />
    <PhotoPrunerNativeView style={styles.keyReceiver} enabled={!busy} onCommand={({ nativeEvent }) => {
      setLastKey(nativeEvent.key);
      console.info('[PhotoPruner] key', nativeEvent.key);
      const command = commandForKey(nativeEvent.key);
      if (command) execute(command);
    }} />
    <View style={styles.header}>
      <View style={styles.grow}><Text style={styles.eyebrow}>PHOTO PRUNER</Text><Text testID="folder-title" style={styles.title}>{folder?.name ?? 'Your next keeper.'}</Text></View>
      {busy && <ActivityIndicator color="#b8edab" />}
      <Button id="sample-folder" label="Sample shoot" disabled={busy} onPress={() => void load(() => Native.createDemoFolder())} />
      <Button id="open-folder" label="Open folder" disabled={busy} onPress={() => void load(() => Native.openFolder())} />
      {folder && <Button id="refresh-folder" label="Rescan" disabled={busy} onPress={() => void load(() => Native.refreshFolder())} />}
    </View>
    {error && <View style={styles.errorBanner}><Text testID="app-error" style={styles.errorText}>{error}</Text><Button id="dismiss-error" label="Dismiss" onPress={() => setError(null)} />{saveStatus === 'Save failed' && <Button id="retry-save" label="Retry save" onPress={() => persist(current.current.review)} />}</View>}
    {!folder ? <View style={styles.empty}>
      <Text style={styles.hero}>Less sorting. More seeing.</Text>
      <Text style={styles.description}>Open a folder from Files, or try the sample shoot.{ '\n' }RAW + JPEG companions appear as one photo.</Text>
      <Text style={styles.muted}>Y keep · N reject · ← → browse · 1–5 stars · U undo</Text>
    </View> : <View style={styles.workspace}>
      <View style={styles.sidebar}>
        <Text testID="library-count" style={styles.libraryCount}>{photos.length} photos · {folder.files.length} files</Text>
        <Text testID="review-summary" style={styles.muted}>{summary.keep} kept · {summary.reject} rejected</Text>
        <FlatList ref={listRef} data={photos} extraData={review} keyExtractor={item => item.id}
          getItemLayout={(_, index) => ({ length: 84, offset: 84 * index, index })}
          renderItem={({ item, index }) => {
            const meta = review.reviews[item.id] ?? EMPTY_REVIEW;
            return <Pressable testID={`photo-${index}`} accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.kind}, ${meta.decision}, ${meta.stars} stars`} onPress={() => select(index)} style={[styles.row, review.index === index && styles.selectedRow]}>
              <Text numberOfLines={1} style={styles.fileName}>{item.name}</Text>
              <Text style={styles.muted}>{item.kind} · {item.files.length} {item.files.length === 1 ? 'file' : 'files'}</Text>
              <Text style={[styles.small, meta.decision === 'keep' && styles.green, meta.decision === 'reject' && styles.red]}>{meta.decision === 'unreviewed' ? 'Unreviewed' : meta.decision === 'keep' ? 'Keep' : 'Reject'}{meta.stars ? `  ${'★'.repeat(meta.stars)}` : ''}</Text>
            </Pressable>;
          }} />
      </View>
      <View style={styles.main}>
        {selected ? <>
          <View style={styles.photoHeader}><Text testID="selected-name" style={styles.selectedName}>{selected.name}</Text><Text testID="position" style={styles.muted}>{review.index + 1} / {photos.length} · {selected.kind}</Text></View>
          <View style={styles.canvas}>
            {preview ? <Image testID="photo-preview" accessibilityLabel={`Preview of ${selected.name}`} source={preview} style={styles.image} contentFit="contain" cachePolicy="memory-disk" recyclingKey={`${folder.id}/${selected.id}`} transition={0} /> : previewError ? <View style={styles.previewMessage}><Text style={styles.selectedName}>Preview unavailable</Text><Text testID="preview-error" style={styles.description}>{previewError}</Text><Text style={styles.muted}>You can still rate and review this item.</Text></View> : <ActivityIndicator size="large" color="#b8edab" />}
          </View>
          <View style={styles.photoFooter}><Text numberOfLines={2} testID="paired-files" style={styles.muted}>{selected.files.map(file => file.name).join(' + ')}</Text><Text testID="decision" style={[styles.decision, rating.decision === 'keep' && styles.green, rating.decision === 'reject' && styles.red]}>{rating.decision === 'unreviewed' ? 'Unreviewed' : rating.decision === 'keep' ? 'Keep' : 'Reject'}</Text></View>
          <View style={styles.controls}>
            <Button id="previous" label="←" disabled={review.index === 0 || busy} onPress={() => execute({ type: 'move', delta: -1 })} />
            <Button id="reject" label="N  Reject" disabled={busy} onPress={() => execute({ type: 'decision', decision: 'reject' })} />
            <Button id="keep" label="Y  Keep" disabled={busy} active={rating.decision === 'keep'} onPress={() => execute({ type: 'decision', decision: 'keep' })} />
            <View style={styles.stars}>{[1, 2, 3, 4, 5].map(star => <Pressable key={star} testID={`star-${star}`} accessibilityRole="button" accessibilityLabel={`${star} stars`} onPress={() => execute({ type: 'rate', stars: star })} style={styles.starButton}><Text style={[styles.star, star <= rating.stars && styles.green]}>{star <= rating.stars ? '★' : '☆'}</Text></Pressable>)}</View>
            <Button id="clear-stars" label="0" disabled={busy} onPress={() => execute({ type: 'rate', stars: 0 })} />
            <Button id="next" label="→" disabled={review.index === photos.length - 1 || busy} onPress={() => execute({ type: 'move', delta: 1 })} />
          </View>
          <View style={styles.photoFooter}><Button id="undo" label="U  Undo" disabled={review.undo.length === 0 || busy} onPress={() => execute({ type: 'undo' })} /><Text testID="stars-value" style={styles.muted}>{rating.stars} / 5 stars</Text><Text style={styles.small}>Keep / reject advances to the next photo.</Text></View>
        </> : <View style={styles.empty}><Text style={styles.hero}>No photos here yet.</Text><Text style={styles.description}>Choose a folder containing JPEG, HEIC, PNG, TIFF, or RAW files.{ '\n' }This prototype reads files directly inside the chosen folder.</Text></View>}
      </View>
    </View>}
    <View style={styles.statusbar}><Text testID="save-status" style={styles.small}>{saveStatus} · Originals unchanged</Text><Text testID="diagnostics" style={styles.small}>{folder ? `Scan ${Math.round(folder.scanMs)} ms · Preview ${previewMs ?? '—'} ms · ` : ''}Key {lastKey} · {UI_REVISION}</Text></View>
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><Workspace /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111412' }, grow: { flex: 1 },
  keyReceiver: { position: 'absolute', width: 1, height: 1, top: 0, left: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 28, paddingVertical: 20, borderBottomWidth: 1, borderColor: '#30372f' },
  eyebrow: { color: '#a6b8a1', fontSize: 11, fontWeight: '700', letterSpacing: 2.5, marginBottom: 6 },
  title: { color: '#f4f6ef', fontSize: 25, fontWeight: '600' },
  button: { minHeight: 42, minWidth: 42, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: '#252d26', borderRadius: 9 },
  activeButton: { backgroundColor: '#b8edab' }, buttonText: { color: '#e8f0e4', fontSize: 14, fontWeight: '600' },
  workspace: { flex: 1, flexDirection: 'row' }, sidebar: { width: 236, borderRightWidth: 1, borderColor: '#30372f', paddingTop: 20, gap: 8 },
  libraryCount: { color: '#e9efe4', fontSize: 15, paddingHorizontal: 18, fontWeight: '600' },
  row: { height: 84, paddingHorizontal: 18, paddingVertical: 11, gap: 5, borderLeftWidth: 3, borderColor: 'transparent' },
  selectedRow: { backgroundColor: '#273329', borderColor: '#b8edab' }, fileName: { color: '#edf2e8', fontSize: 15, fontWeight: '600' },
  main: { flex: 1, padding: 22, gap: 12 }, photoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectedName: { color: '#f3f5ed', fontSize: 18, fontWeight: '600' }, canvas: { flex: 1, minHeight: 100, backgroundColor: '#070a08', justifyContent: 'center', alignItems: 'center', borderRadius: 12, overflow: 'hidden' },
  image: { width: '100%', height: '100%' }, previewMessage: { gap: 18, padding: 30, alignItems: 'center' },
  photoFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 12 },
  stars: { flexDirection: 'row' }, starButton: { minWidth: 40, minHeight: 46, alignItems: 'center', justifyContent: 'center' }, star: { fontSize: 30, color: '#798575' },
  muted: { color: '#aab5a5', fontSize: 13 }, small: { color: '#97a391', fontSize: 11 }, decision: { color: '#aab5a5', fontSize: 14, fontWeight: '600' },
  green: { color: '#b8edab' }, red: { color: '#f6aaa0' }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, padding: 40 },
  hero: { color: '#f1f5eb', fontSize: 34, fontWeight: '500' }, description: { color: '#b5c0af', fontSize: 17, lineHeight: 27, textAlign: 'center' },
  statusbar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 12, borderTopWidth: 1, borderColor: '#30372f' },
  errorBanner: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#472a26' }, errorText: { color: '#ffe3d9', flex: 1, fontSize: 14 },
});
