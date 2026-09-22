import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Native, { PhotoPrunerNativeView } from './modules/photo-pruner-native';
import { commandForKey, EMPTY_REVIEW, reviewFor } from './src/domain/library';
import { errorMessage, useWorkspace } from './src/useWorkspace';
import { UI_REVISION } from './src/revision';

function Button({ label, onPress, id, active = false, disabled = false }: { label: string; onPress: () => void; id: string; active?: boolean; disabled?: boolean }) {
  return <Pressable testID={id} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, active && styles.activeButton, (disabled || pressed) && { opacity: 0.45 }]}><Text style={[styles.buttonText, active && { color: '#0c1610' }]}>{label}</Text></Pressable>;
}
function PreviewFrame({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(0);
  return <View style={styles.previewSpace} onLayout={({ nativeEvent: { layout } }) => setWidth(Math.min(layout.width, layout.height * 4 / 3))}>
    <View testID="preview-frame" style={[styles.canvas, { width, height: width * 3 / 4 }]}>{children}</View>
  </View>;
}

function Workspace() {
  const { folder, photos, review, selected, busy, writable, error, setError, saveStatus, preview: previewState,
    load, execute, select, retrySave, exportPlan, exporting, progress, exportResult, prepareExport, dismissExport, confirmExport, cancelExport } = useWorkspace();
  const listRef = useRef<FlatList>(null);
  const rating = selected ? reviewFor(review.reviews, selected.id) : EMPTY_REVIEW;
  const preview = previewState?.uri;
  const previewError = previewState?.error;
  useEffect(() => {
    if (photos.length) listRef.current?.scrollToIndex({ index: review.index, animated: false, viewPosition: 0.5 });
  }, [review.index, photos.length]);
  const summary = useMemo(() => photos.reduce((acc, photo) => {
    const decision = reviewFor(review.reviews, photo.id).decision;
    if (decision === 'keep') acc.keep++;
    if (decision === 'reject') acc.reject++;
    return acc;
  }, { keep: 0, reject: 0 }), [photos, review.reviews]);
  return <SafeAreaView style={styles.screen}>
    <StatusBar style="light" />
    <PhotoPrunerNativeView style={styles.keyReceiver} enabled={!busy} onCommand={({ nativeEvent }) => {
      const command = commandForKey(nativeEvent.key);
      if (command) execute(command);
    }} />
    <View style={styles.header}>
      <View style={styles.grow}><Text style={styles.eyebrow}>PHOTO PRUNER</Text><Text numberOfLines={1} testID="folder-title" style={styles.title}>{folder?.name ?? 'Your next keeper.'}</Text></View>
      {busy && <ActivityIndicator color="#b8edab" />}
      <Button id="sample-folder" label="Sample shoot" disabled={busy} onPress={() => void load(() => Native.createDemoFolder())} />
      <Button id="open-folder" label="Open folder" disabled={busy} onPress={() => void load(() => Native.openFolder())} />
      {folder && <Button id="export-keepers" label="Export keepers" disabled={busy || !writable || summary.keep === 0} onPress={() => void prepareExport()} />}
      {folder && <Button id="refresh-folder" label="Rescan" disabled={busy} onPress={() => void load(() => Native.refreshFolder())} />}
    </View>
    {(error || saveStatus.state === 'failed') && <View style={styles.errorBanner}><Text testID="app-error" style={styles.errorText}>{error ?? `Could not save review: ${saveStatus.state === 'failed' ? errorMessage(saveStatus.error) : ''}`}</Text>{error && <Button id="dismiss-error" label="Dismiss" onPress={() => setError(null)} />}{saveStatus.state === 'failed' && <Button id="retry-save" label="Retry save" disabled={busy} onPress={() => void retrySave()} />}</View>}
    {exportPlan && <View testID="export-confirmation" style={styles.exportPanel}>
      <Text style={styles.selectedName}>Copy {exportPlan.names.length} RAW {exportPlan.names.length === 1 ? 'file' : 'files'} into a new folder</Text>
      <Text style={styles.muted}>{exportPlan.unreviewed} unreviewed items and {exportPlan.keptWithoutRaw} kept items without RAW files will be skipped. JPEG companions stay here.</Text>
      <Text style={styles.muted}>Star ratings stay in this app. Choose where to create the keepers folder.</Text>
      <View style={styles.controls}><Button id="export-cancel-confirmation" label="Cancel" onPress={dismissExport} /><Button id="export-choose-destination" label="Choose destination" active onPress={() => void confirmExport()} /></View>
    </View>}
    {exporting && <View testID="export-progress" style={styles.exportPanel}>
      <Text style={styles.selectedName}>{progress ? `${progress.phase === 'verifying' ? 'Verifying' : 'Copying'} RAW files · ${progress.copied} / ${progress.total}` : 'Choose a destination folder in Files'}</Text>
      {progress && <Text style={styles.muted}>{Math.round(progress.bytes / 1024 / 1024)} / {Math.round(progress.totalBytes / 1024 / 1024)} MB · A complete folder appears after verification.</Text>}
      <Button id="cancel-export" label="Cancel export" onPress={() => void cancelExport()} />
    </View>}
    {exportResult && <View style={styles.exportPanel}><Text testID="export-result" style={styles.selectedName}>Copied {exportResult.count} RAW {exportResult.count === 1 ? 'file' : 'files'} to {exportResult.name}</Text><Text style={styles.muted}>All copies verified. Originals unchanged. Star ratings remain in this app.</Text></View>}
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
            const meta = reviewFor(review.reviews, item.id);
            return <Pressable testID={`photo-${index}`} accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.kind}, ${meta.decision}, ${meta.stars} stars`} onPress={() => select(index)} style={[styles.row, review.index === index && styles.selectedRow]}>
              <Text numberOfLines={1} style={styles.fileName}>{item.name}</Text>
              <Text style={styles.muted}>{item.kind} · {item.files.length} {item.files.length === 1 ? 'file' : 'files'}</Text>
              <Text style={[styles.small, meta.decision === 'keep' && styles.green, meta.decision === 'reject' && styles.red]}>{meta.decision === 'unreviewed' ? 'Unreviewed' : meta.decision === 'keep' ? 'Keep' : 'Reject'}{meta.stars ? `  ${'★'.repeat(meta.stars)}` : ''}</Text>
            </Pressable>;
          }} />
      </View>
      <View style={styles.main}>
        {selected ? <>
          <View style={styles.photoHeader}><Text numberOfLines={1} testID="selected-name" style={styles.selectedName}>{selected.name}</Text><Text testID="position" style={styles.muted}>{review.index + 1} / {photos.length} · {selected.kind}</Text></View>
          <PreviewFrame>
            {preview ? <Image testID="photo-preview" accessibilityLabel={`Preview of ${selected.name}`} source={preview} style={styles.image} contentFit="contain" cachePolicy="memory" recyclingKey={`${folder.revision}/${selected.id}`} transition={0} /> : previewError ? <View style={styles.previewMessage}><Text style={styles.selectedName}>Preview unavailable</Text><Text testID="preview-error" style={styles.description}>{previewError}</Text><Text style={styles.muted}>You can still rate and review this item.</Text></View> : <ActivityIndicator size="large" color="#b8edab" />}
          </PreviewFrame>
          <View style={styles.photoFooter}><Text numberOfLines={2} testID="paired-files" style={[styles.muted, styles.grow]}>{selected.files.map(file => file.name).join(' + ')}</Text><Text testID="decision" style={[styles.decision, rating.decision === 'keep' && styles.green, rating.decision === 'reject' && styles.red]}>{rating.decision === 'unreviewed' ? 'Unreviewed' : rating.decision === 'keep' ? 'Keep' : 'Reject'}</Text></View>
          <View style={styles.controls}>
            <Button id="previous" label="←" disabled={review.index === 0 || busy} onPress={() => execute({ type: 'move', delta: -1 })} />
            <Button id="reject" label="N  Reject" disabled={busy || !writable} onPress={() => execute({ type: 'decision', decision: 'reject' })} />
            <Button id="keep" label="Y  Keep" disabled={busy || !writable} active={rating.decision === 'keep'} onPress={() => execute({ type: 'decision', decision: 'keep' })} />
            <View style={styles.stars}>{[1, 2, 3, 4, 5].map(star => <Pressable key={star} testID={`star-${star}`} accessibilityRole="button" accessibilityLabel={`${star} stars`} disabled={busy || !writable} onPress={() => execute({ type: 'rate', stars: star })} style={styles.starButton}><Text style={[styles.star, star <= rating.stars && styles.green]}>{star <= rating.stars ? '★' : '☆'}</Text></Pressable>)}</View>
            <Button id="clear-stars" label="0" disabled={busy || !writable} onPress={() => execute({ type: 'rate', stars: 0 })} />
            <Button id="next" label="→" disabled={review.index === photos.length - 1 || busy} onPress={() => execute({ type: 'move', delta: 1 })} />
          </View>
          <View style={styles.photoFooter}><Button id="undo" label="U  Undo" disabled={review.undo.length === 0 || busy || !writable} onPress={() => execute({ type: 'undo' })} /><Text testID="stars-value" style={styles.muted}>{rating.stars} / 5 stars</Text><Text style={styles.small}>Keep / reject advances to the next photo.</Text></View>
        </> : <View style={styles.empty}><Text style={styles.hero}>No photos here yet.</Text><Text style={styles.description}>Choose a folder containing JPEG, HEIC, PNG, TIFF, or RAW files.{ '\n' }Photos are read directly inside the chosen folder.</Text></View>}
      </View>
    </View>}
    <View style={styles.statusbar}><Text testID="save-status" style={styles.small}>{!writable ? 'Review read-only' : saveStatus.state === 'saved' ? 'Saved on this iPad' : saveStatus.state === 'saving' ? 'Saving…' : 'Save failed'} · Originals unchanged</Text><Text testID="diagnostics" style={styles.small}>Y keep · N reject · ← → browse · 1–5 stars{__DEV__ ? ` · ${UI_REVISION}` : ''}</Text></View>
  </SafeAreaView>;
}
export default function App() {
  return <SafeAreaProvider>{Native.apiVersion >= 2 ? <Workspace /> : <SafeAreaView style={styles.screen}><View style={styles.empty}><Text style={styles.hero}>Update the development build</Text><Text style={styles.description}>RAW keeper export needs the new iPad build. Install the latest Photo Pruner build from EAS, then reconnect to this development server.</Text></View></SafeAreaView>}</SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111412' }, grow: { flex: 1 },
  keyReceiver: { position: 'absolute', width: 1, height: 1, top: 0, left: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingHorizontal: 28, paddingVertical: 20, borderBottomWidth: 1, borderColor: '#30372f' },
  eyebrow: { color: '#a6b8a1', fontSize: 11, fontWeight: '700', letterSpacing: 2.5, marginBottom: 6 },
  title: { color: '#f4f6ef', fontSize: 25, fontWeight: '600' },
  button: { minHeight: 42, minWidth: 42, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: '#252d26', borderRadius: 9 },
  activeButton: { backgroundColor: '#b8edab' }, buttonText: { color: '#e8f0e4', fontSize: 14, fontWeight: '600' },
  workspace: { flex: 1, flexDirection: 'row' }, sidebar: { width: 236, borderRightWidth: 1, borderColor: '#30372f', paddingTop: 20, gap: 8 },
  libraryCount: { color: '#e9efe4', fontSize: 15, paddingHorizontal: 18, fontWeight: '600' },
  row: { height: 84, paddingHorizontal: 18, paddingVertical: 11, gap: 5, borderLeftWidth: 3, borderColor: 'transparent' },
  selectedRow: { backgroundColor: '#273329', borderColor: '#b8edab' }, fileName: { color: '#edf2e8', fontSize: 15, fontWeight: '600' },
  main: { flex: 1, padding: 22, gap: 12 }, photoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectedName: { flexShrink: 1, color: '#f3f5ed', fontSize: 18, fontWeight: '600' }, canvas: { backgroundColor: '#070a08', justifyContent: 'center', alignItems: 'center', borderRadius: 12, overflow: 'hidden' },
  previewSpace: { flex: 1, minHeight: 80, alignItems: 'center', justifyContent: 'center' },
  exportPanel: { padding: 16, gap: 10, backgroundColor: '#233027' },
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
