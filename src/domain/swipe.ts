export type SwipeAction = 'keep' | 'reject' | 'next' | 'previous';
export type SwipeAxis = 'horizontal' | 'vertical';

/** Wait for a clear intention; once chosen, the caller keeps this axis for the drag. */
export function swipeAxis(x: number, y: number): SwipeAxis | null {
  'worklet';
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const horizontal = Math.abs(x);
  const vertical = Math.abs(y);
  if (Math.max(horizontal, vertical) < 18) return null;
  if (horizontal >= vertical * 1.35) return 'horizontal';
  if (vertical >= horizontal * 1.35) return 'vertical';
  return null;
}

export function swipeAction(axis: SwipeAxis, x: number, y: number): SwipeAction {
  'worklet';
  return axis === 'horizontal' ? (x > 0 ? 'keep' : 'reject') : (y < 0 ? 'next' : 'previous');
}

export function swipeThreshold(dimension: number): number {
  'worklet';
  return Math.max(56, Math.min(96, Math.round(dimension * 0.14)));
}

export interface SwipeRelease {
  axis: SwipeAxis | null;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  width: number;
  height: number;
}

/** Classify a release, never a move. Tiny flicks and uncertain diagonal releases cancel. */
export function classifySwipe(release: SwipeRelease): SwipeAction | null {
  'worklet';
  const { axis, x, y, velocityX, velocityY, width, height } = release;
  if (!axis || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(velocityX)
    || !Number.isFinite(velocityY) || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0) return null;
  const travel = axis === 'horizontal' ? x : y;
  const crossTravel = axis === 'horizontal' ? y : x;
  const velocity = axis === 'horizontal' ? velocityX : velocityY;
  const crossVelocity = axis === 'horizontal' ? velocityY : velocityX;
  const distance = Math.abs(travel);
  // A drag that turns onto the other axis must start over to make a decision.
  if (distance < 32 || distance < Math.abs(crossTravel) * 1.25) return null;
  const farEnough = distance >= swipeThreshold(axis === 'horizontal' ? width : height);
  const deliberateFlick = Math.abs(velocity) >= 950 && travel * velocity > 0
    && Math.abs(velocity) >= Math.abs(crossVelocity) * 1.25;
  return farEnough || deliberateFlick ? swipeAction(axis, x, y) : null;
}

export function swipeAllowed(action: SwipeAction, canDecide: boolean, canPrevious: boolean, canNext: boolean): boolean {
  'worklet';
  if (action === 'keep' || action === 'reject') return canDecide;
  return action === 'next' ? canNext : canPrevious;
}

export interface SwipeCommitStamp {
  epoch: number;
  token: number;
}

export interface SwipeCommit extends SwipeCommitStamp {
  action: SwipeAction;
  itemKey: string;
}

export interface SwipeCommitState {
  epoch: number;
  itemKey: string;
  lastCommit: SwipeCommitStamp | null;
  mounted: boolean;
  enabled: boolean;
  canDecide: boolean;
  canPrevious: boolean;
  canNext: boolean;
}

/** Check the latest JS state after a release has crossed from the UI thread. */
export function canCommitSwipe(release: SwipeCommit, current: SwipeCommitState): boolean {
  return current.mounted && current.enabled && current.epoch === release.epoch && current.itemKey === release.itemKey
    && !(current.lastCommit?.epoch === release.epoch && current.lastCommit.token >= release.token)
    && swipeAllowed(release.action, current.canDecide, current.canPrevious, current.canNext);
}
