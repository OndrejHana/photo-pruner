import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Native, { PhotoPrunerNativeView } from './modules/photo-pruner-native';
import { commandForKey, EMPTY_REVIEW, reviewFor, type Command } from './src/domain/library';
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

type ImageVisit = { key: string };
type Panel = 'photos' | 'folder' | 'details' | 'help' | null;
function Workspace() {
  const workspace = useWorkspace();
  const { folder, photos, review, selected, busy, writable, error, setError, saveStatus, preview: previewState,
    load, execute, select, retrySave, exportPlan, exporting, progress, exportResult, prepareExport, dismissExport,
    confirmExport, cancelExport, interactionKey, retryPreview, dismissExportResult } = workspace;
  const [panel, setPanel] = useState<Panel>(null);
  const pendingFolder = useRef(false);
  const [closingPanel, setClosingPanel] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [displayedImage, setDisplayedImage] = useState<ImageVisit | null>(null);
  const [imageFailure, setImageFailure] = useState<ImageVisit | null>(null);
  const { width } = useWindowDimensions();
  const compact = width < 700;
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
  const canReview = available && writable && ready;
  const summary = useMemo(() => photos.reduce((acc, photo) => {
    const decision = reviewFor(review.reviews, photo.id).decision;
    if (decision === 'keep') acc.keep++;
    if (decision === 'reject') acc.reject++;
    return acc;
  }, { keep: 0, reject: 0 }), [photos, review.reviews]);
  const remaining = photos.length - summary.keep - summary.reject;
  const atEnd = review.index === photos.length - 1;
  const decisionText = rating.decision === 'keep' ? 'Keep' : rating.decision === 'reject' ? 'Reject' : 'Unreviewed';

  useEffect(() => {
    if (selected) AccessibilityInfo.announceForAccessibilityWithOptions(`${selected.name}, photo ${review.index + 1} of ${photos.length}`, { queue: true });
  }, [selected, review.index, photos.length]);

  function commitCommand(command: Command, expectedKey?: string): boolean {
    const receipt = execute(command, expectedKey);
    if (!receipt) return false;
    const message = command.type === 'decision' ? `${command.decision === 'keep' ? 'Kept' : 'Rejected'} ${receipt.photoName}${receipt.atEnd ? ' · Last photo' : ''}`
      : command.type === 'undo' ? 'Last change undone' : command.type === 'clearDecision' ? 'Decision cleared'
        : command.type === 'rate' ? `${command.stars} stars` : '';
    setFeedback(message);
    if (message) AccessibilityInfo.announceForAccessibility(message);
    return true;
  }
  function act(command: Command, expectedKey?: string) {
    if (!available || (command.type !== 'move' && command.type !== 'undo' && !canReview)) return;
    commitCommand(command, expectedKey);
  }
  function openPanel(next: Panel) { if (!available) return; setFeedback(''); setPanel(next); }
  const closePanel = () => { setClosingPanel(true); setPanel(null); };
  const finishPanelDismiss = () => {
    setClosingPanel(false);
    if (pendingFolder.current) { pendingFolder.current = false; void load(() => Native.openFolder()); }
  };

  return <SafeAreaView style={styles.screen}>
    <StatusBar style="light" />
    <PhotoPrunerNativeView style={styles.keyReceiver} enabled={available} onCommand={({ nativeEvent }) => {
      const command = commandForKey(nativeEvent.key);
      if (command) act(command);
    }} />
    <View style={[styles.header, compact && styles.compactPadding]}>
      <View style={styles.grow}>
        <Text style={styles.eyebrow}>KEEPER</Text>
        <Text numberOfLines={1} testID="folder-title" style={styles.title}>{folder?.name ?? 'Your next keeper.'}</Text>
      </View>
      {busy && <ActivityIndicator color={colors.green} />}
      {folder && <Button id="folder-menu" label="Folder" disabled={busy || closingPanel} onPress={() => openPanel('folder')} />}
      {folder && <Button id="browse-photos" label="Photos" disabled={busy || closingPanel} onPress={() => openPanel('photos')} />}
      {folder && <Button id="export-keepers" label={compact ? 'Export' : 'Export keepers'} disabled={!available || !writable || summary.keep === 0} onPress={() => void prepareExport()} />}
      <Button id="help" label="Help" disabled={busy || closingPanel} onPress={() => openPanel('help')} />
    </View>
    {(error || saveStatus.state === 'failed') && <View style={styles.errorBanner}>
      <Text testID="app-error" style={styles.errorText}>{error ?? `Could not save review: ${saveStatus.state === 'failed' ? errorMessage(saveStatus.error) : ''}`}</Text>
      {error && <Button id="dismiss-error" label="Dismiss" onPress={() => setError(null)} />}
      {saveStatus.state === 'failed' && <Button id="retry-save" label="Retry save" disabled={busy || closingPanel} onPress={() => void retrySave()} />}
    </View>}
    {exportResult && <View style={styles.notice}>
      <View style={styles.grow}><Text testID="export-result" style={styles.body}>Copied {exportResult.count} RAW {exportResult.count === 1 ? 'file' : 'files'} to {exportResult.name}</Text>
        <Text style={styles.muted}>All copies verified. Originals unchanged.</Text></View>
      <Button id="dismiss-export-result" label="Done" onPress={dismissExportResult} />
    </View>}
    {exportPlan ? <View testID="export-confirmation" style={styles.exportPage}>
      <Text style={styles.eyebrow}>YOUR KEEPERS</Text>
      <Text style={styles.hero}>Copy {exportPlan.names.length} RAW {exportPlan.names.length === 1 ? 'file' : 'files'}</Text>
      <Text style={styles.description}>Choose where to create a new Keepers folder.</Text>
      <Text style={styles.description}>{exportPlan.unreviewed} unreviewed items and {exportPlan.keptWithoutRaw} kept items without RAW files will be skipped. JPEG companions stay in the source folder.</Text>
      <Text style={styles.muted}>Star ratings stay in this app. Originals are never changed.</Text>
      <View style={styles.controls}><Button id="export-cancel-confirmation" label="Back to review" onPress={dismissExport} />
        <Button id="export-choose-destination" label="Choose destination" tone="keep" onPress={() => void confirmExport()} /></View>
    </View> : exporting ? <View testID="export-progress" style={styles.exportPage}>
      <ActivityIndicator size="large" color={colors.green} />
      <Text style={styles.title}>{progress ? `${progress.phase === 'verifying' ? 'Verifying' : 'Copying'} RAW files · ${progress.copied} / ${progress.total}` : 'Choose a destination folder in Files'}</Text>
      {progress && <Text style={styles.description}>{Math.round(progress.bytes / 1024 / 1024)} / {Math.round(progress.totalBytes / 1024 / 1024)} MB</Text>}
      <Text style={styles.muted}>Your Keepers folder is ready only after every copy is verified.</Text>
      <Button id="cancel-export" label="Cancel export" onPress={() => void cancelExport()} />
    </View> : !folder ? <View style={styles.empty}>
      <Text style={styles.hero}>A shoot full of possibilities.</Text>
      <Text style={styles.description}>Keep the ones that matter.{ '\n' }Open a folder from Files to start culling.</Text>
      <View style={styles.controls}><Button id="open-folder" label="Open folder" tone="keep" disabled={busy || closingPanel} onPress={() => void load(() => Native.openFolder())} />
        <Button id="sample-folder" label="Try sample shoot" disabled={busy || closingPanel} onPress={() => void load(() => Native.createDemoFolder())} /></View>
      <Text style={styles.muted}>RAW + JPEG companions appear as one photo.</Text>
      <Text style={styles.swipeHint}>Swipe: ← Reject     Keep →{ '\n' }↑ Next     ↓ Previous</Text>
    </View> : selected ? <View style={[styles.workspace, compact && styles.compactPadding]}>
      <View style={styles.photoHeader}>
        <View style={styles.grow}><Text numberOfLines={1} testID="selected-name" style={styles.selectedName}>{selected.name}</Text>
          <Text testID="position" style={styles.muted}>{review.index + 1} / {photos.length} · {selected.kind}</Text></View>
        <Text testID="decision" style={[styles.decision, rating.decision === 'keep' && styles.green, rating.decision === 'reject' && styles.red]}>{decisionText}</Text>
        <Button id="photo-details" label="Details" disabled={busy || closingPanel} onPress={() => openPanel('details')} />
      </View>
      <PreviewFrame>
        <SwipePhoto itemKey={interactionKey} enabled={available} canDecide={writable && ready} canPrevious={review.index > 0} canNext={!atEnd}
          onSwipe={(action, key) => act(action === 'next' || action === 'previous' ? { type: 'move', delta: action === 'next' ? 1 : -1 } : { type: 'decision', decision: action }, key)}>
          {previewError ? <View style={styles.previewMessage}><Text style={styles.selectedName}>Preview unavailable</Text>
            <Text testID="preview-error" style={styles.description}>{previewError}</Text>
            <Text style={styles.muted}>You can still choose to keep or reject this photo.</Text>
            <Button id="retry-preview" label="Retry preview" disabled={busy || closingPanel} onPress={() => { setImageFailure(null); setDisplayedImage(null); retryPreview(); }} />
          </View> : preview ? <Image key={photoKey} testID="photo-preview" accessible accessibilityLabel={`Preview of ${selected.name}`}
            accessibilityHint="Swipe right to keep, left to reject, up for the next photo, or down for the previous photo. Review and navigation buttons are below."
            source={preview} style={styles.image} contentFit="contain" cachePolicy="memory"
            recyclingKey={photoKey} transition={0} onDisplay={() => { if (currentImageVisit.current === imageVisit) setDisplayedImage(imageVisit); }} onError={() => { if (currentImageVisit.current === imageVisit) setImageFailure(imageVisit); }} /> : <ActivityIndicator size="large" color={colors.green} />}
        </SwipePhoto>
      </PreviewFrame>
      <View style={styles.reviewDock}>
        <Text testID="swipe-hint" style={styles.swipeHint}>Swipe: ← Reject     Keep →     ·     ↑ Next     ↓ Previous</Text>
        <View style={styles.controls}>
          <Button id="undo" label="Undo" disabled={review.undo.length === 0 || !available || !writable} onPress={() => act({ type: 'undo' })} />
          <Button id="previous" label="Previous" disabled={review.index === 0 || !available} onPress={() => act({ type: 'move', delta: -1 })} />
          <Button id="reject" label="✕  Reject" accessibilityLabel="Reject photo" tone="reject" disabled={!canReview} active={rating.decision === 'reject'} onPress={() => act({ type: 'decision', decision: 'reject' })} />
          <Button id="keep" label="✓  Keep" accessibilityLabel="Keep photo" tone="keep" disabled={!canReview} active={rating.decision === 'keep'} onPress={() => act({ type: 'decision', decision: 'keep' })} />
          <Button id="next" label="Next" disabled={atEnd || !available} onPress={() => act({ type: 'move', delta: 1 })} />
        </View>
        <View style={styles.controls}>
          <View style={styles.stars}>{[1, 2, 3, 4, 5].map(star => <Pressable key={star} testID={`star-${star}`} accessibilityRole="button" accessibilityLabel={`${star} stars`}
            accessibilityState={{ selected: star === rating.stars, disabled: !canReview }} disabled={!canReview} onPress={() => act({ type: 'rate', stars: star })} style={styles.starButton}>
            <Text style={[styles.star, star <= rating.stars && styles.green]}>{star <= rating.stars ? '★' : '☆'}</Text>
          </Pressable>)}</View>
          <Button id="clear-stars" label="Clear stars" disabled={!canReview || rating.stars === 0} onPress={() => act({ type: 'rate', stars: 0 })} />
          <Text testID="stars-value" style={styles.muted}>{rating.stars} / 5 stars</Text>
        </View>
        <Text testID="action-feedback" accessibilityLiveRegion="polite" style={styles.feedback}>{feedback || (remaining === 0 ? 'Every photo reviewed. Open Photos to revisit your choices.' : atEnd ? `Last photo · ${remaining} still unreviewed` : 'Keep or reject advances. Browsing leaves decisions unchanged.')}</Text>
      </View>
      <View style={styles.summary}>
        <Text testID="review-summary" style={styles.muted}>{summary.keep} kept · {summary.reject} rejected</Text>
        <Text testID="review-remaining" style={styles.muted}>{remaining === 0 ? 'Review complete' : `${remaining} unreviewed`}</Text>
      </View>
    </View> : <View style={styles.empty}><Text style={styles.hero}>No photos in this folder.</Text><Text style={styles.description}>Use Folder to open a folder containing JPEG, HEIC, PNG, TIFF, or RAW files.</Text></View>}
    <View style={styles.statusbar}><Text testID="save-status" style={styles.small}>{!writable ? 'Review read-only' : saveStatus.state === 'saved' ? 'Saved on this iPad' : saveStatus.state === 'saving' ? 'Saving…' : 'Save failed'} · Originals unchanged</Text>
      {__DEV__ && <Text testID="diagnostics" style={styles.small}>{UI_REVISION}</Text>}</View>

    <Sheet title="Photos in this shoot" visible={panel === 'photos'} onClose={closePanel} onDismiss={finishPanelDismiss} scroll={false}>
      <View style={styles.browserSummary}><Text testID="library-count" style={styles.body}>{photos.length} photos · {folder?.files.length} files</Text><Text style={styles.muted}>Tap a photo to return to it. Decisions stay unchanged.</Text></View>
      <FlatList data={photos} extraData={review} keyExtractor={item => item.id} initialScrollIndex={review.index}
        getItemLayout={(_, index) => ({ length: 88, offset: 88 * index, index })}
        renderItem={({ item, index }) => {
          const meta = reviewFor(review.reviews, item.id);
          return <Pressable testID={`photo-${index}`} accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.kind}, ${meta.decision}, ${meta.stars} stars`}
            accessibilityState={{ selected: review.index === index }} onPress={() => { select(index); setFeedback(''); closePanel(); }} style={[styles.row, review.index === index && styles.selectedRow]}>
            <View style={styles.grow}><Text numberOfLines={1} style={styles.body}>{item.name}</Text><Text style={styles.muted}>{item.kind} · {item.files.length} files</Text></View>
            <Text style={[styles.body, meta.decision === 'keep' && styles.green, meta.decision === 'reject' && styles.red]}>{meta.decision === 'unreviewed' ? 'Unreviewed' : meta.decision === 'keep' ? '✓ Keep' : '✕ Reject'}{meta.stars ? `  ${'★'.repeat(meta.stars)}` : ''}</Text>
          </Pressable>;
        }} />
    </Sheet>
    <Sheet title="Source folder" visible={panel === 'folder'} onClose={closePanel} onDismiss={finishPanelDismiss}>
      <Text style={styles.title}>{folder?.name}</Text>
      <Text style={styles.description}>Your progress saves automatically on this iPad. Source photos stay unchanged.</Text>
      <Button id="refresh-folder" label="Rescan folder" disabled={busy || closingPanel} onPress={() => { closePanel(); void load(() => Native.refreshFolder()); }} />
      <Button id="open-folder" label="Open another folder" disabled={busy || closingPanel} onPress={() => { pendingFolder.current = true; closePanel(); }} />
      <Button id="sample-folder" label="Try sample shoot" disabled={busy || closingPanel} onPress={() => { closePanel(); void load(() => Native.createDemoFolder()); }} />
    </Sheet>
    <Sheet title="Photo details" visible={panel === 'details'} onClose={closePanel} onDismiss={finishPanelDismiss}>
      <Text style={styles.title}>{selected?.name}</Text>
      <Text testID="paired-files" style={styles.body}>{selected?.files.map(file => file.name).join(' + ')}</Text>
      <Text style={styles.muted}>A RAW file and its JPEG companion are reviewed together. Stars are saved separately from your keep decision.</Text>
      <Button id="clear-decision" label="Clear decision" disabled={busy || closingPanel || !writable || rating.decision === 'unreviewed'} onPress={() => {
        if (panel === 'details' && !closingPanel && commitCommand({ type: 'clearDecision' }, interactionKey)) closePanel();
      }} />
    </Sheet>
    <Sheet title="A few simple moves" visible={panel === 'help'} onClose={closePanel} onDismiss={finishPanelDismiss}>
      <Text style={styles.selectedName}>Swipe gestures</Text>
      <Text style={styles.helpLine}>→  Keep this photo and advance</Text><Text style={styles.helpLine}>←  Reject this photo and advance</Text>
      <Text style={styles.helpLine}>↑  Next photo, without deciding</Text><Text style={styles.helpLine}>↓  Previous photo, without deciding</Text>
      <Text style={styles.body}>You can use the buttons for every action. Undo returns to the photo you changed. A short swipe returns the photo without changing anything.</Text>
      <Text style={styles.body}>Stars never imply Keep. Only explicitly kept RAW files are exported as copies.</Text>
      <Text style={styles.selectedName}>With a keyboard</Text><Text style={styles.body}>Y keep · N reject · ← / ↑ previous · → / ↓ next · 0–5 stars · U undo</Text>
    </Sheet>
  </SafeAreaView>;
}

export default function App() {
  return <GestureHandlerRootView style={styles.grow}><SafeAreaProvider>{Native.apiVersion >= 2 ? <Workspace /> : <SafeAreaView style={styles.screen}><View style={styles.empty}><Text style={styles.hero}>Update the development build</Text><Text style={styles.description}>Install the latest Keeper build from EAS, then reconnect to this development server.</Text></View></SafeAreaView>}</SafeAreaProvider></GestureHandlerRootView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, grow: { flex: 1 },
  keyReceiver: { position: 'absolute', width: 1, height: 1, top: 0, left: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border },
  compactPadding: { paddingHorizontal: 12 }, eyebrow: { color: colors.green, fontSize: 11, fontWeight: '700', letterSpacing: 3, marginBottom: 4 },
  title: { color: colors.text, fontSize: 24, fontWeight: '600' }, selectedName: { color: colors.text, fontSize: 19, fontWeight: '600' },
  body: { color: colors.text, fontSize: 16, lineHeight: 24 }, muted: { color: colors.muted, fontSize: 13, lineHeight: 19 }, small: { color: colors.muted, fontSize: 11 },
  workspace: { flex: 1, paddingHorizontal: 24, paddingTop: 12, gap: 10 }, photoHeader: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  previewSpace: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center' }, canvas: { backgroundColor: '#070a08', borderRadius: 18, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '100%' }, previewMessage: { flex: 1, padding: 24, gap: 12, alignItems: 'center', justifyContent: 'center' },
  reviewDock: { gap: 8, alignItems: 'center' }, controls: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  swipeHint: { color: colors.muted, fontSize: 14, lineHeight: 24, textAlign: 'center' }, feedback: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', minHeight: 20 },
  stars: { flexDirection: 'row' }, starButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, star: { fontSize: 30, color: '#91a08c' },
  decision: { color: colors.muted, fontSize: 15, fontWeight: '600' }, green: { color: colors.green }, red: { color: colors.red },
  summary: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }, statusbar: { flexDirection: 'row', gap: 12, justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 9, borderTopWidth: 1, borderColor: colors.border },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, padding: 32 }, hero: { color: colors.text, fontSize: 34, fontWeight: '500', textAlign: 'center' },
  description: { color: colors.muted, fontSize: 17, lineHeight: 26, textAlign: 'center', maxWidth: 640 },
  errorBanner: { padding: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, backgroundColor: '#472a26' }, errorText: { color: '#ffe3d9', flex: 1, fontSize: 14 },
  notice: { padding: 14, gap: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: '#233027' }, exportPage: { flex: 1, padding: 32, gap: 22, alignItems: 'center', justifyContent: 'center' },
  browserSummary: { padding: 20, gap: 8 }, row: { height: 88, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: colors.border }, selectedRow: { backgroundColor: '#2c3d2e' },
  helpLine: { color: colors.green, fontSize: 20, lineHeight: 28 },
});
