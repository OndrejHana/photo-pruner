import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion,
  useSharedValue, withSpring, type SharedValue,
} from 'react-native-reanimated';
import { canCommitSwipe, classifySwipe, swipeAction, swipeAllowed, swipeAxis,
  type SwipeAction, type SwipeAxis, type SwipeCommitStamp } from '../domain/swipe';

interface SwipePhotoProps {
  itemKey: string;
  enabled: boolean;
  canDecide: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onSwipe: (action: SwipeAction, itemKey: string) => void;
  children: ReactNode;
}

const spring = { damping: 26, stiffness: 280, overshootClamping: true, reduceMotion: ReduceMotion.System };

function SwipeBadge({ action, preview, label, available }: {
  action: SwipeAction;
  preview: SharedValue<SwipeAction | null>;
  label: string;
  available: boolean;
}) {
  const feedback = useAnimatedStyle(() => ({ opacity: preview.get() === action ? 1 : 0 }));
  return <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.badge, styles[action], !available && styles.unavailable, feedback]}>
    <Text style={styles.badgeText}>{label}</Text>
  </Animated.View>;
}

/** A single review gesture. Decisions happen at release, independently of animation completion. */
export function SwipePhoto({ itemKey, enabled, canDecide, canPrevious, canNext, onSwipe, children }: SwipePhotoProps) {
  const initialReducedMotion = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const axis = useSharedValue<SwipeAxis | null>(null);
  const preview = useSharedValue<SwipeAction | null>(null);
  const epoch = useSharedValue(0);
  const currentKey = useSharedValue(itemKey);
  const startKey = useSharedValue(itemKey);
  const startEpoch = useSharedValue(-1);
  const sequence = useSharedValue(0);
  const startSequence = useSharedValue(-1);
  const finished = useSharedValue(false);
  const multipleTouches = useSharedValue(false);
  const availability = useSharedValue({ canDecide, canPrevious, canNext });
  const generation = useRef(0);
  const lastCommit = useRef<SwipeCommitStamp | null>(null);
  const current = useRef({ itemKey, enabled, canDecide, canPrevious, canNext, onSwipe, mounted: true });

  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReducedMotion(value); });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const invalidate = useCallback(() => {
    generation.current += 1;
    epoch.set(generation.current);
    cancelAnimation(x);
    cancelAnimation(y);
    x.set(0);
    y.set(0);
    axis.set(null);
    preview.set(null);
    finished.set(true);
  }, [axis, epoch, finished, preview, x, y]);

  useLayoutEffect(() => {
    current.current = { itemKey, enabled, canDecide, canPrevious, canNext, onSwipe, mounted: true };
    availability.set({ canDecide, canPrevious, canNext });
  }, [itemKey, enabled, canDecide, canPrevious, canNext, onSwipe, availability]);

  useLayoutEffect(() => {
    current.current.mounted = true;
    currentKey.set(itemKey);
    invalidate();
    return () => {
      current.current.mounted = false;
      invalidate();
    };
  }, [itemKey, enabled, reducedMotion, size.width, size.height, currentKey, invalidate]);

  const commit = useCallback((action: SwipeAction, key: string, gestureEpoch: number, token: number) => {
    const snapshot = current.current;
    // JS checks again after crossing threads: navigation or a busy state may have happened meanwhile.
    if (!canCommitSwipe({ action, itemKey: key, epoch: gestureEpoch, token },
      { ...snapshot, epoch: generation.current, lastCommit: lastCommit.current })) return;
    lastCommit.current = { epoch: gestureEpoch, token };
    snapshot.onSwipe(action, key);
  }, []);

  const onLayout = useCallback(({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    if (layout.width !== size.width || layout.height !== size.height) {
      // Invalidate immediately; do not leave a release queued during a rotation/layout update.
      invalidate();
      setSize({ width: layout.width, height: layout.height });
    }
  }, [invalidate, size.width, size.height]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(enabled && size.width > 0 && size.height > 0)
    .minDistance(10)
    .maxPointers(1)
    .onBegin(() => {
      cancelAnimation(x);
      cancelAnimation(y);
      x.set(0);
      y.set(0);
      axis.set(null);
      preview.set(null);
      startKey.set(currentKey.get());
      startEpoch.set(epoch.get());
      sequence.set(sequence.get() + 1);
      startSequence.set(sequence.get());
      finished.set(false);
      multipleTouches.set(false);
    })
    .onTouchesDown(event => {
      if (event.numberOfTouches > 1) multipleTouches.set(true);
    })
    .onUpdate(event => {
      if (startEpoch.get() !== epoch.get() || finished.get()) return;
      if (event.numberOfPointers > 1) multipleTouches.set(true);
      if (multipleTouches.get()) {
        preview.set(null);
        x.set(0);
        y.set(0);
        return;
      }
      if (!axis.get()) axis.set(swipeAxis(event.translationX, event.translationY));
      const lockedAxis = axis.get();
      preview.set(lockedAxis ? swipeAction(lockedAxis, event.translationX, event.translationY) : null);
      // Keep the image in view. Reduced motion retains the label without moving the image.
      x.set(reducedMotion ? 0 : Math.max(-130, Math.min(130, event.translationX * (axis.get() === 'horizontal' ? 0.7 : 0.12))));
      y.set(reducedMotion ? 0 : Math.max(-110, Math.min(110, event.translationY * (axis.get() === 'vertical' ? 0.7 : 0.12))));
    })
    // RNGH registers this callback; the ref-reading JS commit runs only after release.
    // eslint-disable-next-line react-hooks/refs
    .onEnd((event, success) => {
      if (!success || finished.get() || multipleTouches.get() || startEpoch.get() !== epoch.get()) return;
      finished.set(true);
      const action = classifySwipe({ axis: axis.get(), x: event.translationX, y: event.translationY,
        velocityX: event.velocityX, velocityY: event.velocityY, width: size.width, height: size.height });
      const latest = availability.get();
      if (action && swipeAllowed(action, latest.canDecide, latest.canPrevious, latest.canNext)) {
        runOnJS(commit)(action, startKey.get(), startEpoch.get(), startSequence.get());
      }
    })
    .onFinalize(() => {
      if (startEpoch.get() !== epoch.get()) return;
      finished.set(true);
      axis.set(null);
      preview.set(null);
      x.set(withSpring(0, spring));
      y.set(withSpring(0, spring));
    }), [enabled, size.width, size.height, reducedMotion, commit, availability,
    axis, currentKey, epoch, finished, multipleTouches, preview, sequence, startEpoch, startKey, startSequence, x, y]);

  const photoStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }] }));
  const decisionSuffix = !canDecide ? ' · Unavailable' : !canNext ? ' · Last photo' : ' · Next photo';

  return <GestureDetector gesture={gesture}>
    <View testID="swipe-photo" accessible={false} collapsable={false} onLayout={onLayout} style={styles.frame}>
      <Animated.View style={[styles.photo, photoStyle]}>{children}</Animated.View>
      <View pointerEvents="none" style={styles.feedback} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SwipeBadge action="keep" preview={preview} label={`→ Keep${decisionSuffix}`} available={canDecide} />
        <SwipeBadge action="reject" preview={preview} label={`← Reject${decisionSuffix}`} available={canDecide} />
        <SwipeBadge action="next" preview={preview} label={canNext ? '↑ Next · No decision' : '↑ Next · Last photo'} available={canNext} />
        <SwipeBadge action="previous" preview={preview} label={canPrevious ? '↓ Previous' : '↓ Previous · First photo'} available={canPrevious} />
      </View>
    </View>
  </GestureDetector>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', height: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  feedback: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', maxWidth: '92%', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 14,
    borderWidth: 2, borderColor: '#ffffff', backgroundColor: '#172821' },
  keep: { backgroundColor: '#21562f' },
  reject: { backgroundColor: '#742d38' },
  next: { backgroundColor: '#234a6a' },
  previous: { backgroundColor: '#234a6a' },
  unavailable: { backgroundColor: '#343c43', borderColor: '#acb7bd' },
  badgeText: { color: '#ffffff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
});
