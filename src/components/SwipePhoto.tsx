import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, Easing, ReduceMotion, runOnJS, useAnimatedReaction, useAnimatedStyle,
  useDerivedValue, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue,
} from 'react-native-reanimated';
import {
  canCommitSwipe, classifySwipe, swipeAllowed, swipeAxis, swipeExit, swipeFeedback, swipeThreshold, swipeTravel,
  type SwipeAction, type SwipeAxis, type SwipeCommitStamp, type SwipeFeedback, type SwipeRelease,
} from '../domain/swipe';

export interface SwipeEntry { id: string; from: 'left' | 'right' | 'top' | 'bottom' }
interface SwipePhotoProps {
  itemKey: string;
  enabled: boolean;
  canDecide: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onSwipe: (action: SwipeAction, itemKey: string) => boolean;
  children: ReactNode;
  snapshot?: ReactNode;
  nextSnapshot?: ReactNode;
  previousSnapshot?: ReactNode;
  entry?: SwipeEntry | null;
  scopeKey?: string;
}

const returnSpring = { mass: 1, damping: 23, stiffness: 250, reduceMotion: ReduceMotion.System };
const transitionTiming = { duration: 190, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };
const emptyRelease: SwipeRelease = { axis: null, x: 0, y: 0, velocityX: 0, velocityY: 0, width: 0, height: 0 };
const actionColor = { keep: '#8deb9f', reject: '#ff8d97', next: '#9dcffc', previous: '#9dcffc' };
const actionIcon = { keep: '✓', reject: '✕', next: '↑', previous: '↓' };

type Leaving = { id: string; action: SwipeAction; image: ReactNode; scopeKey: string; x: number; y: number; width: number; height: number };

function LeavingPhoto({ layer, reducedMotion, onDone }: { layer: Leaving; reducedMotion: boolean; onDone: (id: string) => void }) {
  const x = useSharedValue(reducedMotion ? 0 : layer.x);
  const y = useSharedValue(reducedMotion ? 0 : layer.y);
  const rotation = useSharedValue(reducedMotion || layer.action === 'next' || layer.action === 'previous' ? 0
    : Math.max(-4, Math.min(4, layer.x / Math.max(1, layer.width) * 8)));
  const opacity = useSharedValue(1);
  useEffect(() => {
    const exit = swipeExit(layer.action, layer.width, layer.height);
    if (!reducedMotion) {
      x.set(withTiming(exit.x, transitionTiming));
      y.set(withTiming(exit.y, transitionTiming));
      rotation.set(withTiming(exit.rotation, transitionTiming));
    }
    // Reveal the live item promptly; the rest of the exit never gates its input.
    opacity.set(withTiming(0, { duration: reducedMotion ? 90 : 130, reduceMotion: ReduceMotion.Never }));
    const timer = setTimeout(() => onDone(layer.id), 220);
    return () => clearTimeout(timer);
  }, [layer, reducedMotion, onDone, opacity, rotation, x, y]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [
    { translateX: x.get() }, { translateY: y.get() }, { rotateZ: `${rotation.get()}deg` },
  ] }));
  return <Animated.View testID="swipe-outgoing" pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.layer, styles.photo, styles.transparentPhoto, style]}>
    {layer.image}
  </Animated.View>;
}

function EdgeFeedback({ action, feedback }: { action: SwipeAction; feedback: SharedValue<SwipeFeedback> }) {
  const armed = useSharedValue(0);
  useAnimatedReaction(() => feedback.get().action === action && feedback.get().armed, (ready, previous) => {
    if (ready !== previous) armed.set(withSpring(ready ? 1 : 0,
      { mass: 1, damping: 16, stiffness: 500, reduceMotion: ReduceMotion.Never }));
  });
  const glow = useAnimatedStyle(() => {
    const value = feedback.get();
    const active = value.action === action && value.available;
    return { opacity: active ? 0.05 + value.progress * 0.1 + armed.get() * 0.14 : 0 };
  });
  const edge = useAnimatedStyle(() => {
    const value = feedback.get();
    return { opacity: value.action === action && value.available ? value.armed ? 1 : value.progress * 0.4 : 0 };
  });
  const icon = useAnimatedStyle(() => {
    const value = feedback.get();
    const active = value.action === action && value.available;
    return { opacity: active ? value.armed ? 1 : 0.15 + value.progress * 0.5 : 0,
      transform: [{ scale: 0.72 + value.progress * 0.28 + armed.get() * 0.15 }] };
  });
  return <>
    <Animated.View style={[styles.glow, styles[`${action}Glow`], { backgroundColor: actionColor[action] }, glow]} />
    <Animated.View style={[styles.edge, styles[`${action}Edge`], { backgroundColor: actionColor[action] }, edge]} />
    <Animated.View testID={`swipe-feedback-${action}`} style={[styles.icon, styles[`${action}Icon`], { borderColor: actionColor[action] }, icon]}>
      <Text style={[styles.iconText, { color: actionColor[action] }]}>{actionIcon[action]}</Text>
    </Animated.View>
  </>;
}

/** Release commits immediately; separate decorative layers own all exit animation. */
export function SwipePhoto({ itemKey, enabled, canDecide, canPrevious, canNext, onSwipe, children,
  snapshot, nextSnapshot, previousSnapshot, entry, scopeKey = '' }: SwipePhotoProps) {
  const initialReducedMotion = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const leavingContext = JSON.stringify([scopeKey, size.width, size.height]);
  const [leaving, setLeaving] = useState({ context: leavingContext, layers: [] as Leaving[] });
  // Discard old snapshots before rendering a changed frame, rather than merely hiding them.
  // Ordinary item changes keep this context, allowing a legitimate exit to finish.
  if (leaving.context !== leavingContext) setLeaving({ context: leavingContext, layers: [] });
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const incomingX = useSharedValue(0);
  const incomingY = useSharedValue(0);
  const incomingScale = useSharedValue(1);
  const axis = useSharedValue<SwipeAxis | null>(null);
  const measurements = useSharedValue<SwipeRelease>(emptyRelease);
  const epoch = useSharedValue(0);
  const currentKey = useSharedValue(itemKey);
  const startKey = useSharedValue(itemKey);
  const startEpoch = useSharedValue(-1);
  const sequence = useSharedValue(0);
  const startSequence = useSharedValue(-1);
  const finished = useSharedValue(false);
  const releasePending = useSharedValue(false);
  const multipleTouches = useSharedValue(false);
  const availability = useSharedValue({ canDecide, canPrevious, canNext });
  const feedback = useDerivedValue(() => swipeFeedback(measurements.get(), availability.get()));
  const generation = useRef(0);
  const lastCommit = useRef<SwipeCommitStamp | null>(null);
  const pendingIncoming = useRef<SwipeAction | null>(null);
  const consumedEntry = useRef<string | null>(null);
  const current = useRef({ itemKey, enabled, canDecide, canPrevious, canNext, onSwipe, snapshot, scopeKey, mounted: true });

  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReducedMotion(value); });
    return () => { mounted = false; subscription.remove(); };
  }, []);

  const invalidate = useCallback(() => {
    generation.current += 1;
    epoch.set(generation.current);
    for (const value of [x, y, incomingX, incomingY]) { cancelAnimation(value); value.set(0); }
    cancelAnimation(incomingScale);
    incomingScale.set(1);
    axis.set(null);
    measurements.set(emptyRelease);
    releasePending.set(false);
    finished.set(true);
  }, [axis, epoch, finished, incomingScale, incomingX, incomingY, measurements, releasePending, x, y]);

  useLayoutEffect(() => {
    current.current = { itemKey, enabled, canDecide, canPrevious, canNext, onSwipe, snapshot, scopeKey, mounted: true };
    availability.set({ canDecide, canPrevious, canNext });
  }, [itemKey, enabled, canDecide, canPrevious, canNext, onSwipe, snapshot, scopeKey, availability]);

  useLayoutEffect(() => {
    current.current.mounted = true;
    currentKey.set(itemKey);
    invalidate();
    const action = pendingIncoming.current;
    pendingIncoming.current = null;
    if (action && !reducedMotion && enabled) {
      // Short entry offsets preserve immediate visibility, even before an outgoing image has faded.
      if (action === 'next' || action === 'previous') {
        incomingY.set(action === 'next' ? 36 : -36);
        incomingY.set(withTiming(0, transitionTiming));
      } else {
        incomingScale.set(0.97);
        incomingScale.set(withTiming(1, transitionTiming));
      }
    }
    return () => { current.current.mounted = false; invalidate(); };
  }, [itemKey, enabled, reducedMotion, scopeKey, size.width, size.height, currentKey, incomingScale, incomingY, invalidate]);

  useLayoutEffect(() => {
    if (!entry || consumedEntry.current === entry.id) return;
    consumedEntry.current = entry.id;
    if (!enabled || reducedMotion) return;
    if (entry.from === 'left' || entry.from === 'right') {
      incomingX.set(entry.from === 'left' ? -48 : 48);
      incomingX.set(withTiming(0, transitionTiming));
    } else {
      incomingY.set(entry.from === 'top' ? -36 : 36);
      incomingY.set(withTiming(0, transitionTiming));
    }
  }, [entry, enabled, reducedMotion, incomingX, incomingY]);

  const settle = useCallback(() => {
    measurements.set(emptyRelease);
    axis.set(null);
    releasePending.set(false);
    x.set(withSpring(0, returnSpring));
    y.set(withSpring(0, returnSpring));
  }, [axis, measurements, releasePending, x, y]);
  const removeLeaving = useCallback((id: string) => setLeaving(previous => ({
    ...previous, layers: previous.layers.filter(layer => layer.id !== id),
  })), []);

  const commit = useCallback((action: SwipeAction, key: string, gestureEpoch: number, token: number, releaseX: number, releaseY: number) => {
    const value = current.current;
    if (!canCommitSwipe({ action, itemKey: key, epoch: gestureEpoch, token },
      { ...value, epoch: generation.current, lastCommit: lastCommit.current })) {
      if (generation.current === gestureEpoch && value.itemKey === key) settle();
      return;
    }
    lastCommit.current = { epoch: gestureEpoch, token };
    // Acceptance is synchronous. A stale command or a final-item no-op gets cancellation feedback.
    if (!value.onSwipe(action, key)) { settle(); return; }
    pendingIncoming.current = action;
    if (value.snapshot) {
      const layer: Leaving = { id: `${gestureEpoch}:${token}`, action, image: value.snapshot, scopeKey: value.scopeKey,
        x: releaseX, y: releaseY, width: size.width, height: size.height };
      setLeaving(previous => ({ context: leavingContext,
        layers: [...(previous.context === leavingContext ? previous.layers.slice(-1) : []), layer] }));
    }
  }, [settle, size.width, size.height, leavingContext]);

  const onLayout = useCallback(({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    if (layout.width !== size.width || layout.height !== size.height) {
      invalidate();
      setSize({ width: layout.width, height: layout.height });
    }
  }, [invalidate, size.width, size.height]);

  const gesture = useMemo(() => Gesture.Pan().enabled(enabled && size.width > 0 && size.height > 0).minDistance(10).maxPointers(1)
    .onBegin(() => {
      for (const value of [x, y, incomingX, incomingY]) { cancelAnimation(value); value.set(0); }
      cancelAnimation(incomingScale);
      incomingScale.set(1);
      axis.set(null);
      measurements.set(emptyRelease);
      startKey.set(currentKey.get());
      startEpoch.set(epoch.get());
      sequence.set(sequence.get() + 1);
      startSequence.set(sequence.get());
      finished.set(false);
      releasePending.set(false);
      multipleTouches.set(false);
    })
    .onTouchesDown(event => { if (event.numberOfTouches > 1) multipleTouches.set(true); })
    .onUpdate(event => {
      if (startEpoch.get() !== epoch.get() || finished.get()) return;
      if (event.numberOfPointers > 1) multipleTouches.set(true);
      if (multipleTouches.get()) {
        measurements.set(emptyRelease);
        x.set(withSpring(0, returnSpring));
        y.set(withSpring(0, returnSpring));
        return;
      }
      if (!axis.get()) axis.set(swipeAxis(event.translationX, event.translationY));
      const lockedAxis = axis.get();
      const release: SwipeRelease = { axis: lockedAxis, x: event.translationX, y: event.translationY,
        velocityX: event.velocityX, velocityY: event.velocityY, width: size.width, height: size.height };
      measurements.set(release);
      const status = swipeFeedback(release, availability.get());
      x.set(reducedMotion || lockedAxis === 'vertical' ? 0 : swipeTravel(event.translationX, swipeThreshold(size.width), lockedAxis ? status.available : true));
      y.set(reducedMotion || lockedAxis === 'horizontal' ? 0 : swipeTravel(event.translationY, swipeThreshold(size.height), lockedAxis ? status.available : true));
    })
    // RNGH registers this callback; the ref-reading commit runs on JS only after release.
    // eslint-disable-next-line react-hooks/refs
    .onEnd((event, success) => {
      if (!success || finished.get() || multipleTouches.get() || startEpoch.get() !== epoch.get()) return;
      finished.set(true);
      const release: SwipeRelease = { axis: axis.get(), x: event.translationX, y: event.translationY,
        velocityX: event.velocityX, velocityY: event.velocityY, width: size.width, height: size.height };
      measurements.set(release);
      const action = classifySwipe(release);
      const latest = availability.get();
      if (action && swipeAllowed(action, latest.canDecide, latest.canPrevious, latest.canNext)) {
        releasePending.set(true);
        runOnJS(commit)(action, startKey.get(), startEpoch.get(), startSequence.get(), x.get(), y.get());
      }
    })
    .onFinalize(() => {
      if (startEpoch.get() !== epoch.get() || releasePending.get()) return;
      finished.set(true);
      axis.set(null);
      measurements.set(emptyRelease);
      x.set(withSpring(0, returnSpring));
      y.set(withSpring(0, returnSpring));
    }), [enabled, size.width, size.height, reducedMotion, commit, availability, axis, currentKey, epoch, finished,
    incomingScale, incomingX, incomingY, measurements, multipleTouches, releasePending, sequence, startEpoch, startKey, startSequence, x, y]);

  const photoStyle = useAnimatedStyle(() => ({ transform: [
    { translateX: x.get() + incomingX.get() }, { translateY: y.get() + incomingY.get() },
    { rotateZ: `${axis.get() === 'horizontal' ? Math.max(-4, Math.min(4, x.get() / Math.max(1, size.width) * 8)) : 0}deg` },
    { scale: incomingScale.get() },
  ] }));
  const nextStyle = useAnimatedStyle(() => {
    const value = feedback.get();
    return { opacity: value.available && value.action !== 'previous' && value.action !== null ? 0.88 : 0,
      transform: [{ translateY: value.action === 'next' ? size.height + y.get() : 0 }, { scale: 0.97 + value.progress * 0.03 }] };
  });
  const previousStyle = useAnimatedStyle(() => {
    const value = feedback.get();
    return { opacity: value.available && value.action === 'previous' ? 0.88 : 0,
      transform: [{ translateY: -size.height + y.get() }] };
  });

  return <GestureDetector gesture={gesture}>
    <View testID="swipe-photo" accessible={false} collapsable={false} onLayout={onLayout} style={styles.frame}>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.layer}>
        {nextSnapshot && <Animated.View style={[styles.layer, styles.photo, nextStyle]}>{nextSnapshot}</Animated.View>}
        {previousSnapshot && <Animated.View style={[styles.layer, styles.photo, previousStyle]}>{previousSnapshot}</Animated.View>}
      </View>
      <Animated.View style={[styles.photo, photoStyle]}>{children}</Animated.View>
      {leaving.layers
        .map(layer => <LeavingPhoto key={layer.id} layer={layer} reducedMotion={reducedMotion} onDone={removeLeaving} />)}
      <View pointerEvents="none" style={styles.layer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {(['keep', 'reject', 'next', 'previous'] as const).map(action => <EdgeFeedback key={action} action={action} feedback={feedback} />)}
      </View>
    </View>
  </GestureDetector>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', height: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#070a08' },
  transparentPhoto: { backgroundColor: 'transparent' },
  layer: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  glow: { position: 'absolute' }, edge: { position: 'absolute' },
  keepGlow: { right: 0, top: 0, bottom: 0, width: 72 }, rejectGlow: { left: 0, top: 0, bottom: 0, width: 72 },
  nextGlow: { top: 0, left: 0, right: 0, height: 72 }, previousGlow: { bottom: 0, left: 0, right: 0, height: 72 },
  keepEdge: { right: 0, top: 0, bottom: 0, width: 3 }, rejectEdge: { left: 0, top: 0, bottom: 0, width: 3 },
  nextEdge: { top: 0, left: 0, right: 0, height: 3 }, previousEdge: { bottom: 0, left: 0, right: 0, height: 3 },
  icon: { position: 'absolute', width: 48, height: 48, borderRadius: 24, borderWidth: 2, backgroundColor: '#132019', alignItems: 'center', justifyContent: 'center' },
  keepIcon: { right: 18, top: '50%', marginTop: -24 }, rejectIcon: { left: 18, top: '50%', marginTop: -24 },
  nextIcon: { top: 18, left: '50%', marginLeft: -24 }, previousIcon: { bottom: 18, left: '50%', marginLeft: -24 },
  iconText: { fontSize: 28, fontWeight: '700', lineHeight: 34 },
});
