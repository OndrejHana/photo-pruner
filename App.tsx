import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Native, { PhotoPrunerNativeView } from './modules/photo-pruner-native';
import { commandForKey, EMPTY_REVIEW, reviewFor, type Command, type Photo, type ReviewState } from './src/domain/library';
import { errorMessage, useWorkspace } from './src/useWorkspace';
import { Button, colors, Sheet } from './src/components/ReviewControls';
import { SwipePhoto } from './src/components/SwipePhoto';
import { UI_REVISION } from './src/revision';

function PreviewFrame({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(0);
  return <View style={styles.previewSpace} onLayout={({ nativeEvent: { layout } }) => setWidth(Math.max(0, Math.min(layout.width, layout.height * 4 / 3)))}>
    <View testID="preview-frame" style={[styles.canvas, { width, height: width * 3 / 4 }]}>{children}</View>
  </View>;
}

function PhotoList({ photos, review, disabled, onSelect }: { photos: Photo[]; review: ReviewState; disabled: boolean; onSelect: (index: number) => void }) {
  const list = useRef<FlatList<Photo>>(null);
  useEffect(() => {
    if (photos.length) list.current?.scrollToIndex({ index: review.index, animated: false, viewPosition: 0.5 });
  }, [review.index, photos.length]);
  return <FlatList ref={list} data={photos} extraData={{ review, disabled }} keyExtractor={item => item.id}
    initialScrollIndex={photos.length ? review.index : undefined} getItemLayout={(_, index) => ({ length: 84, offset: 84 * index, index })}
    renderItem={({ item, index }) => {
      const meta = reviewFor(review.reviews, item.id);
      return <Pressable testID={`photo-${index}`} accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.kind}, ${meta.decision}, ${meta.stars} ${meta.stars === 1 ? 'star' : 'stars'}`}
        accessibilityState={{ selected: review.index === index, disabled }} disabled={disabled} onPress={() => onSelect(index)}
        style={[styles.row, meta.decision === 'keep' && styles.keptRow, meta.decision === 'reject' && styles.rejectedRow, review.index === index && styles.selectedRow]}>
        <Text numberOfLines={1} style={styles.fileName}>{item.name}</Text>
        <Text style={styles.muted}>{item.kind} · {item.files.length} {item.files.length === 1 ? 'file' : 'files'}</Text>
        <Text style={[styles.small, meta.decision === 'keep' && styles.green, meta.decision === 'reject' && styles.red]}>{meta.decision === 'unreviewed' ? 'Unreviewed' : meta.decision === 'keep' ? 'Keep' : 'Reject'}{meta.stars ? `  ${'★'.repeat(meta.stars)}` : ''}</Text>
      </Pressable>;
    }} />;
}

type ImageVisit = { key: string };
function Workspace() {
  const { folder, photos, review, selected, busy, writable, error, setError, saveStatus, preview: previewState, adjacentPreviews,
    load, execute, select, retrySave, exportPlan, exporting, progress, exportResult, prepareExport, dismissExport,
    confirmExport, cancelExport, interactionKey, retryPreview, dismissExportResult } = useWorkspace();
  const [panel, setPanel] = useState<'photos' | 'help' | null>(null);
  const [closingPanel, setClosingPanel] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; scope: string }>();
  const [entry, setEntry] = useState<{ id: string; scope: string; from: 'left' | 'right' | 'top' | 'bottom' }>();
  const entrySerial = useRef(0);
  const [displayedImage, setDisplayedImage] = useState<ImageVisit | null>(null);
  const [imageFailure, setImageFailure] = useState<ImageVisit | null>(null);
  const { width } = useWindowDimensions();
  const wide = width >= 1100;
  const rating = selected ? reviewFor(review.reviews, selected.id) : EMPTY_REVIEW;
  const preview = previewState?.uri;
  const photoKey = `${folder?.revision}/${selected?.id}/${preview ?? ''}`;
  // Each visit has its own identity, including A → B → A before image callbacks finish.
  const imageVisit = useMemo(() => ({ key: photoKey }), [photoKey]);
  const currentImageVisit = useRef(imageVisit);
  useLayoutEffect(() => { currentImageVisit.current = imageVisit; }, [imageVisit]);
  const previewError = previewState?.error ?? (imageFailure === imageVisit ? 'This preview could not be displayed. Try loading it again.' : null);
  const ready = !!previewError || (!!preview && displayedImage === imageVisit);
  const available = !busy && panel === null && !closingPanel;
  const canReview = available && writable;
  const summary = useMemo(() => photos.reduce((acc, photo) => {
    const decision = reviewFor(review.reviews, photo.id).decision;
    if (decision === 'keep') acc.keep++;
    if (decision === 'reject') acc.reject++;
    return acc;
  }, { keep: 0, reject: 0 }), [photos, review.reviews]);
  const remaining = photos.length - summary.keep - summary.reject;
  const atEnd = review.index === photos.length - 1;

  useEffect(() => {
    if (selected) AccessibilityInfo.announceForAccessibilityWithOptions(`${selected.name}, photo ${review.index + 1} of ${photos.length}`, { queue: true });
  }, [selected, review.index, photos.length]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(undefined), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  function act(command: Command, expectedKey?: string) {
    // Keyboard/buttons act on the synchronous current selection, even during decoding.
    // Gesture readiness is checked by SwipePhoto, which also supplies its captured key.
    if (!available) return false;
    const receipt = execute(command, expectedKey);
    if (!receipt) return false;
    if (command.type === 'undo' && receipt.undoneDecision && receipt.fromIndex !== receipt.toIndex) {
      setEntry({ id: String(++entrySerial.current), scope: folder?.revision ?? '', from: receipt.undoneDecision === 'keep' ? 'right' : 'left' });
    } else setEntry(undefined);
    const message = command.type === 'decision' ? `${command.decision === 'keep' ? 'Kept' : 'Rejected'} ${receipt.photoName}${receipt.atEnd ? ' · Last photo' : ''}`
      : command.type === 'undo' ? 'Last change undone' : command.type === 'clearDecision' ? 'Decision cleared'
        : command.type === 'rate' || command.type === 'toggleRating' ? receipt.stars === 0 ? 'Stars cleared' : `${receipt.stars} ${receipt.stars === 1 ? 'star' : 'stars'}` : '';
    setFeedback(message ? { message, scope: folder?.revision ?? '' } : undefined);
    if (message) AccessibilityInfo.announceForAccessibility(message);
    return true;
  }
  function loadFolder(operation: Parameters<typeof load>[0]) {
    setFeedback(undefined); setEntry(undefined);
    void load(operation);
  }
  const closePanel = () => { setClosingPanel(true); setPanel(null); };
  function selectPhoto(index: number) {
    select(index); setEntry(undefined); setFeedback(undefined);
    if (panel === 'photos') closePanel();
  }
  const reviewSummary = <View style={styles.summary}>
    <View testID="review-progress" accessible accessibilityRole="progressbar" accessibilityLabel="Photos reviewed"
      accessibilityValue={{ min: 0, max: photos.length, now: photos.length - remaining, text: `${photos.length - remaining} of ${photos.length} reviewed` }} style={styles.progressTrack}>
      <View style={[styles.progressKeep, { width: `${photos.length ? summary.keep / photos.length * 100 : 0}%` }]} />
      <View style={[styles.progressReject, { width: `${photos.length ? summary.reject / photos.length * 100 : 0}%` }]} />
    </View>
    <Text testID="review-summary" style={styles.muted}>{summary.keep} kept · {summary.reject} rejected</Text>
    <Text testID="review-remaining" style={styles.small}>{remaining === 0 ? 'Review complete' : `${remaining} unreviewed`}</Text>
    {photos.length > 0 && remaining === 0 && <View testID="review-complete" style={styles.complete}>
      <Text style={styles.completeTitle}>✓ All {photos.length} reviewed</Text>
      <Text style={styles.small}>{summary.keep ? `${summary.keep} ${summary.keep === 1 ? 'keeper' : 'keepers'} · Export when you’re ready` : 'No keepers yet · You can revisit any photo'}</Text>
    </View>}
  </View>;
  const libraryCount = <Text testID="library-count" style={styles.libraryCount}>{photos.length} {photos.length === 1 ? 'photo' : 'photos'} · {folder?.files.length} {folder?.files.length === 1 ? 'file' : 'files'}</Text>;
  // Decorative layers never report display/error or participate in accessibility.
  const snapshot = (uri: string | null | undefined) => uri ? <Image source={uri} style={styles.image} contentFit="contain" cachePolicy="memory" transition={0} accessible={false} /> : undefined;
  const nextPreview = adjacentPreviews.find(item => item.offset === 1 && item.memoryReady);
  const previousPreview = adjacentPreviews.find(item => item.offset === -1 && item.memoryReady);

  return <SafeAreaView style={styles.screen}>
    <StatusBar style="light" />
    <PhotoPrunerNativeView style={styles.keyReceiver} enabled={available} onCommand={({ nativeEvent }) => {
      const command = commandForKey(nativeEvent.key);
      if (command) act(command);
    }} />
    <View style={styles.header}>
      <View style={styles.grow}><Text style={styles.eyebrow}>KEEPER</Text><Text numberOfLines={1} testID="folder-title" style={styles.title}>{folder?.name ?? 'Your next keeper.'}</Text></View>
      {busy && <ActivityIndicator color={colors.green} />}
      <Button id="sample-folder" label="Sample shoot" tone="quiet" disabled={!available} onPress={() => loadFolder(() => Native.createDemoFolder())} />
      <Button id="open-folder" label="Open folder" tone="quiet" disabled={!available} onPress={() => loadFolder(() => Native.openFolder())} />
      {folder && <Button id="export-keepers" label={summary.keep ? `Export ${summary.keep} ${summary.keep === 1 ? 'keeper' : 'keepers'}` : 'Export keepers'} tone="keep" disabled={!canReview || summary.keep === 0} onPress={() => void prepareExport()} />}
      {folder && <Button id="refresh-folder" label="Rescan" tone="quiet" disabled={!available} onPress={() => loadFolder(() => Native.refreshFolder())} />}
      {folder && !wide && <Button id="browse-photos" label="Photos" tone="quiet" disabled={!available} onPress={() => setPanel('photos')} />}
      <Button id="help" label="Help" tone="quiet" disabled={!available} onPress={() => setPanel('help')} />
    </View>
    {(error || saveStatus.state === 'failed') && <View style={styles.errorBanner}>
      <Text testID="app-error" style={styles.errorText}>{error ?? `Could not save review: ${saveStatus.state === 'failed' ? errorMessage(saveStatus.error) : ''}`}</Text>
      {error && <Button id="dismiss-error" label="Dismiss" onPress={() => setError(null)} />}
      {saveStatus.state === 'failed' && <Button id="retry-save" label="Retry save" disabled={!available} onPress={() => void retrySave()} />}
    </View>}
    {exportPlan && <View testID="export-confirmation" style={styles.exportPanel}>
      <Text style={styles.selectedName}>Copy {exportPlan.names.length} RAW {exportPlan.names.length === 1 ? 'file' : 'files'} into a new folder</Text>
      <Text style={styles.muted}>{exportPlan.unreviewed} unreviewed {exportPlan.unreviewed === 1 ? 'item' : 'items'} and {exportPlan.keptWithoutRaw} kept {exportPlan.keptWithoutRaw === 1 ? 'item' : 'items'} without RAW files will be skipped. JPEG companions stay here.</Text>
      <Text style={styles.muted}>Star ratings stay in this app. Choose where to create the Keepers folder.</Text>
      <View style={styles.controls}><Button id="export-cancel-confirmation" label="Back to review" onPress={dismissExport} />
        <Button id="export-choose-destination" label="Choose destination" tone="keep" onPress={() => void confirmExport()} /></View>
    </View>}
    {exporting && <View testID="export-progress" style={styles.exportPanel}>
      <Text style={styles.selectedName}>{progress ? `${progress.phase === 'verifying' ? 'Verifying' : 'Copying'} RAW files · ${progress.copied} / ${progress.total}` : 'Choose a destination folder in Files'}</Text>
      {progress && <Text style={styles.muted}>{Math.round(progress.bytes / 1024 / 1024)} / {Math.round(progress.totalBytes / 1024 / 1024)} MB · A complete folder appears after verification.</Text>}
      <Button id="cancel-export" label="Cancel export" onPress={() => void cancelExport()} />
    </View>}
    {exportResult && <View style={styles.notice}>
      <View style={styles.grow}><Text testID="export-result" style={styles.body}>Copied {exportResult.count} RAW {exportResult.count === 1 ? 'file' : 'files'} to {exportResult.name}</Text>
        <Text style={styles.muted}>All copies verified. Originals unchanged. Star ratings remain in this app.</Text></View>
      <Button id="dismiss-export-result" label="Done" onPress={dismissExportResult} />
    </View>}
    {!folder ? <View style={styles.empty}>
      <Text style={styles.hero}>Less sorting. More seeing.</Text>
      <Text style={styles.description}>Open a folder from Files, or try the sample shoot.{ '\n' }RAW + JPEG companions appear as one photo.</Text>
      <Text style={styles.muted}>Swipe: ← Reject · Keep → · ↑ Next · ↓ Previous</Text>
    </View> : <View style={styles.workspace}>
      {wide && <View testID="photo-sidebar" style={styles.sidebar}>
        {libraryCount}{reviewSummary}
        <PhotoList photos={photos} review={review} disabled={!available} onSelect={selectPhoto} />
        <Text testID="swipe-hint" style={styles.sidebarHint}>Swipe: ← Reject · Keep →{ '\n' }↑ Next · ↓ Previous</Text>
      </View>}
      <View style={styles.main}>
        {selected ? <>
          <View style={styles.photoHeader}><Text numberOfLines={1} testID="selected-name" style={styles.selectedName}>{selected.name}</Text><Text testID="position" style={styles.muted}>{review.index + 1} / {photos.length} · {selected.kind}</Text></View>
          <PreviewFrame>
            <SwipePhoto itemKey={interactionKey} scopeKey={folder.revision} enabled={available} canDecide={writable && ready} canPrevious={review.index > 0} canNext={!atEnd}
              snapshot={ready && !previewError ? snapshot(preview) : undefined} nextSnapshot={snapshot(nextPreview?.uri)} previousSnapshot={snapshot(previousPreview?.uri)} entry={entry?.scope === folder.revision ? entry : undefined}
              onSwipe={(action, key) => act(action === 'next' || action === 'previous' ? { type: 'move', delta: action === 'next' ? 1 : -1 } : { type: 'decision', decision: action }, key)}>
              {previewError ? <View style={styles.previewMessage}><Text style={styles.selectedName}>Preview unavailable</Text>
                <Text testID="preview-error" style={styles.description}>{previewError}</Text><Text style={styles.muted}>You can still rate and review this item.</Text>
                <Button id="retry-preview" label="Retry preview" disabled={!available} onPress={() => { setImageFailure(null); setDisplayedImage(null); retryPreview(); }} />
              </View> : preview ? <Image key={photoKey} testID="photo-preview" accessible accessibilityLabel={`Preview of ${selected.name}`}
                accessibilityHint="Use the Keep, Reject, Previous, Next, and Undo buttons below the photo to review it."
                source={preview} style={styles.image} contentFit="contain" cachePolicy="memory" recyclingKey={photoKey} transition={0}
                onDisplay={() => { if (currentImageVisit.current === imageVisit) setDisplayedImage(imageVisit); }} onError={() => { if (currentImageVisit.current === imageVisit) setImageFailure(imageVisit); }} /> : <ActivityIndicator size="large" color={colors.green} />}
            </SwipePhoto>
            {rating.decision !== 'unreviewed' && <View testID="photo-decision" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
              style={[styles.decisionFrame, rating.decision === 'keep' ? styles.keptFrame : styles.rejectedFrame]}>
              <View style={[styles.decisionBadge, rating.decision === 'keep' ? styles.keptBadge : styles.rejectedBadge]}>
                <Text style={styles.decisionBadgeText}>{rating.decision === 'keep' ? '✓ Keep' : '✕ Reject'}</Text>
              </View>
            </View>}
            {feedback && feedback.scope === folder.revision && <View pointerEvents="box-none" style={styles.feedback}>
              <Text testID="action-feedback" pointerEvents="none" numberOfLines={2} style={[styles.body, styles.feedbackText]}>{feedback.message}</Text>
              {review.undo.length > 0 && <Button id="feedback-undo" label="Undo" tone="quiet" disabled={!canReview} onPress={() => act({ type: 'undo' })} />}
            </View>}
          </PreviewFrame>
          <View style={styles.photoFooter}>
            <View style={styles.grow}><Text numberOfLines={2} testID="paired-files" style={styles.muted}>{selected.files.map(file => file.name).join(' + ')}</Text>
              <Text testID="preview-status" style={styles.small}>{previewError ? 'Preview unavailable' : ready ? 'Preview ready' : 'Loading preview'}</Text></View>
            <Text testID="decision" style={[styles.decision, rating.decision === 'keep' && styles.green, rating.decision === 'reject' && styles.red]}>{rating.decision === 'unreviewed' ? 'Unreviewed' : rating.decision === 'keep' ? 'Keep' : 'Reject'}</Text>
            <Button id="clear-decision" label="Clear decision" tone="quiet" disabled={!canReview || rating.decision === 'unreviewed'} onPress={() => act({ type: 'clearDecision' })} />
          </View>
          <View style={styles.controls}>
            <Button id="previous" label="←" accessibilityLabel="Previous" tone="quiet" disabled={review.index === 0 || !available} onPress={() => act({ type: 'move', delta: -1 })} />
            <Button id="reject" label="✕ Reject" accessibilityLabel="Reject photo" tone="reject" prominent disabled={!canReview} active={rating.decision === 'reject'} onPress={() => act({ type: 'decision', decision: 'reject' })} />
            <Button id="undo" label="↶ Undo" accessibilityLabel="Undo" tone="quiet" disabled={review.undo.length === 0 || !canReview} onPress={() => act({ type: 'undo' })} />
            <Button id="keep" label="✓ Keep" accessibilityLabel="Keep photo" tone="keep" prominent disabled={!canReview} active={rating.decision === 'keep'} onPress={() => act({ type: 'decision', decision: 'keep' })} />
            <View style={styles.stars}>{[1, 2, 3, 4, 5].map(star => <Pressable key={star} testID={`star-${star}`} accessibilityRole="button" accessibilityLabel={`${star} ${star === 1 ? 'star' : 'stars'}`}
              accessibilityHint={star === rating.stars ? 'Tap again to clear stars' : undefined}
              accessibilityState={{ selected: star === rating.stars, disabled: !canReview }} disabled={!canReview} onPress={() => act({ type: 'toggleRating', stars: star })} style={styles.starButton}>
              <Text style={[styles.star, star <= rating.stars && styles.green]}>{star <= rating.stars ? '★' : '☆'}</Text>
            </Pressable>)}</View>
            <Button id="clear-stars" label="0" accessibilityLabel="Clear stars" tone="quiet" disabled={!canReview || rating.stars === 0} onPress={() => act({ type: 'rate', stars: 0 })} />
            <Text testID="stars-value" style={styles.muted}>{rating.stars} / 5 stars</Text>
            <Button id="next" label="→" accessibilityLabel="Next" tone="quiet" disabled={atEnd || !available} onPress={() => act({ type: 'move', delta: 1 })} />
          </View>
          {!wide && reviewSummary}
        </> : <View style={styles.empty}><Text style={styles.hero}>No photos here yet.</Text><Text style={styles.description}>Choose a folder containing JPEG, HEIC, PNG, TIFF, or RAW files.</Text></View>}
      </View>
    </View>}
    <View style={styles.statusbar}><Text testID="save-status" style={styles.small}>{!writable ? 'Review read-only' : saveStatus.state === 'saved' ? 'Saved on this iPad' : saveStatus.state === 'saving' ? 'Saving…' : 'Save failed'} · Originals unchanged</Text>
      <Text testID="keyboard-hint" style={styles.small}>Y keep · N reject · ← / ↑ previous · → / ↓ next · 0–5 stars · U undo</Text>
      {__DEV__ && <Text testID="diagnostics" style={styles.small}>{UI_REVISION}</Text>}</View>
    <Sheet title="Photos in this shoot" visible={panel === 'photos'} onClose={closePanel} onDismiss={() => setClosingPanel(false)} scroll={false}>
      {libraryCount}<PhotoList photos={photos} review={review} disabled={busy || closingPanel} onSelect={selectPhoto} />
    </Sheet>
    <Sheet title="A few simple moves" visible={panel === 'help'} onClose={closePanel} onDismiss={() => setClosingPanel(false)}>
      <Text style={styles.selectedName}>Swipe gestures</Text>
      <Text style={styles.helpLine}>→ Keep and advance · ← Reject and advance</Text><Text style={styles.helpLine}>↑ Next · ↓ Previous, without deciding</Text>
      <Text style={styles.body}>Buttons and keyboard shortcuts work while previews load. Undo returns to the photo you changed. A short swipe returns without changing anything.</Text>
      <Text style={styles.body}>Stars never imply Keep. Only explicitly kept RAW files are exported as copies.</Text>
      <Text style={styles.body}>Tap a selected star again to clear the rating. A border and corner badge mark reviewed photos; their image colours stay unchanged.</Text>
      <Text style={styles.selectedName}>With a keyboard</Text><Text style={styles.body}>Y keep · N reject · ← / ↑ previous · → / ↓ next · 0–5 stars · U undo</Text>
    </Sheet>
  </SafeAreaView>;
}

export default function App() {
  return <GestureHandlerRootView style={styles.grow}><SafeAreaProvider>{Native.apiVersion >= 2 ? <Workspace /> : <SafeAreaView style={styles.screen}><View style={styles.empty}><Text style={styles.hero}>Update the development build</Text><Text style={styles.description}>Install the latest Keeper build from EAS, then reconnect to this development server.</Text></View></SafeAreaView>}</SafeAreaProvider></GestureHandlerRootView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, grow: { flex: 1 }, keyReceiver: { position: 'absolute', width: 1, height: 1, top: 0, left: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingHorizontal: 24, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.border },
  eyebrow: { color: colors.green, fontSize: 11, fontWeight: '700', letterSpacing: 2.5, marginBottom: 4 }, title: { color: colors.text, fontSize: 25, fontWeight: '600' },
  workspace: { flex: 1, flexDirection: 'row' }, sidebar: { width: 236, borderRightWidth: 1, borderColor: colors.border, paddingTop: 16, gap: 8 },
  libraryCount: { color: colors.text, fontSize: 15, paddingHorizontal: 18, paddingVertical: 8, fontWeight: '600' }, summary: { paddingHorizontal: 18, gap: 4 },
  row: { height: 84, paddingHorizontal: 18, paddingVertical: 10, gap: 4, borderLeftWidth: 3, borderColor: 'transparent' },
  keptRow: { borderColor: colors.green }, rejectedRow: { borderColor: colors.red, opacity: 0.78 }, selectedRow: { backgroundColor: '#273329', opacity: 1 },
  progressTrack: { height: 5, marginBottom: 4, borderRadius: 3, backgroundColor: '#343d35', overflow: 'hidden', flexDirection: 'row' },
  progressKeep: { height: '100%', backgroundColor: colors.green }, progressReject: { height: '100%', backgroundColor: colors.red },
  complete: { paddingVertical: 10, gap: 5 }, completeTitle: { color: colors.green, fontSize: 15, fontWeight: '600' },
  fileName: { color: colors.text, fontSize: 15, fontWeight: '600' }, sidebarHint: { color: colors.muted, fontSize: 12, lineHeight: 20, padding: 16 },
  main: { flex: 1, padding: 22, gap: 8 }, photoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  selectedName: { flexShrink: 1, color: colors.text, fontSize: 18, fontWeight: '600' }, previewSpace: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center' },
  canvas: { backgroundColor: '#070a08', borderRadius: 12, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }, image: { width: '100%', height: '100%' },
  decisionFrame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2, borderRadius: 12 },
  keptFrame: { borderColor: colors.green }, rejectedFrame: { borderColor: colors.red },
  decisionBadge: { position: 'absolute', top: 12, left: 12, borderRadius: 6, paddingHorizontal: 11, paddingVertical: 7 },
  keptBadge: { backgroundColor: colors.green }, rejectedBadge: { backgroundColor: colors.red },
  decisionBadgeText: { color: '#172313', fontSize: 14, fontWeight: '700' },
  previewMessage: { padding: 24, gap: 16, alignItems: 'center', justifyContent: 'center' }, photoFooter: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8 }, stars: { flexDirection: 'row' },
  starButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, star: { fontSize: 30, color: '#91a08c' },
  decision: { color: colors.muted, fontSize: 14, fontWeight: '600' }, green: { color: colors.green }, red: { color: colors.red },
  body: { color: colors.text, fontSize: 16, lineHeight: 24 }, muted: { color: colors.muted, fontSize: 13, lineHeight: 19 }, small: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  feedback: { position: 'absolute', bottom: 12, maxWidth: '92%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 2, borderRadius: 8, backgroundColor: '#18251ff5' },
  feedbackText: { flexShrink: 1 },
  statusbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 10, borderTopWidth: 1, borderColor: colors.border },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, padding: 32 }, hero: { color: colors.text, fontSize: 34, fontWeight: '500' },
  description: { color: colors.muted, fontSize: 17, lineHeight: 26, textAlign: 'center' }, errorBanner: { padding: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, backgroundColor: '#472a26' },
  errorText: { color: '#ffe3d9', flex: 1, fontSize: 14 }, exportPanel: { padding: 16, gap: 8, backgroundColor: '#233027' }, notice: { padding: 14, gap: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: '#233027' },
  helpLine: { color: colors.green, fontSize: 18, lineHeight: 26 },
});
