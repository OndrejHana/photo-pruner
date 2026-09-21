export type PhotoFile = { name: string; size: number };
export type Photo = { id: string; name: string; files: PhotoFile[]; previewName: string; kind: string };
export type Decision = 'keep' | 'reject' | 'unreviewed';
export type Review = { decision: Decision; stars: number };
export type Reviews = Record<string, Review>;
export type ReviewDocument = { version: 1; selectedID: string | null; reviews: Reviews };
export const EMPTY_REVIEW: Review = { decision: 'unreviewed', stars: 0 };
const RAW = new Set(['dng', 'nef', 'nrw', 'cr2', 'cr3', 'crw', 'arw', 'sr2', 'srf', 'raf', 'orf', 'rw2', 'pef', 'rwl', 'raw', 'srw']);
const IMAGES = new Set(['jpg', 'jpeg', 'heic', 'heif', 'png', 'tif', 'tiff']);
const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const collator = new Intl.Collator('en', { numeric: true });
const compare = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/** Pair files only within the same directory. Prefer a JPEG companion for preview. */
export function groupPhotos(files: PhotoFile[]): Photo[] {
  const groups = new Map<string, PhotoFile[]>();
  for (const file of files) {
    const ext = extension(file.name);
    if (!RAW.has(ext) && !IMAGES.has(ext)) continue;
    const dot = file.name.lastIndexOf('.');
    const slash = file.name.lastIndexOf('/');
    const id = file.name.slice(0, slash + 1) + file.name.slice(slash + 1, dot).toLowerCase();
    const group = groups.get(id) ?? [];
    group.push(file);
    groups.set(id, group);
  }
  return [...groups].map(([id, members]) => {
    const files = members.slice().sort((a, b) => compare(a.name, b.name));
    const raw = files.some(f => RAW.has(extension(f.name)));
    const jpeg = files.find(f => ['jpg', 'jpeg'].includes(extension(f.name)));
    const preview = jpeg ?? files.find(f => IMAGES.has(extension(f.name))) ?? files[0];
    return { id, name: preview.name.slice(0, preview.name.lastIndexOf('.')), files, previewName: preview.name,
      kind: raw && jpeg ? 'RAW + JPEG' : raw ? 'RAW' : extension(preview.name).toUpperCase() };
  }).sort((a, b) => compare(a.name, b.name));
}

export type Command = { type: 'move'; delta: number } | { type: 'decision'; decision: Decision } | { type: 'rate'; stars: number } | { type: 'undo' };
export function commandForKey(key: string): Command | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return { type: 'move', delta: 1 };
  if (key === 'ArrowLeft' || key === 'ArrowUp') return { type: 'move', delta: -1 };
  if (key.toLowerCase() === 'y') return { type: 'decision', decision: 'keep' };
  if (key.toLowerCase() === 'n') return { type: 'decision', decision: 'reject' };
  if (key.toLowerCase() === 'u') return { type: 'undo' };
  if (/^[0-5]$/.test(key)) return { type: 'rate', stars: Number(key) };
  return null;
}

type UndoEntry = { id: string; previous: Review; selectedIndex: number };
export type ReviewState = { index: number; reviews: Reviews; undo: UndoEntry[] };
export function applyCommand(state: ReviewState, command: Command, photos: Photo[]): ReviewState {
  const photo = photos[state.index];
  if (!photo) return state;
  if (command.type === 'move') return { ...state, index: Math.max(0, Math.min(photos.length - 1, state.index + command.delta)) };
  if (command.type === 'undo') {
    const entry = state.undo.at(-1);
    if (!entry) return state;
    return { reviews: { ...state.reviews, [entry.id]: entry.previous }, index: entry.selectedIndex, undo: state.undo.slice(0, -1) };
  }
  const previous = state.reviews[photo.id] ?? EMPTY_REVIEW;
  const next = command.type === 'rate' ? { ...previous, stars: Math.max(0, Math.min(5, Math.round(command.stars))) } : { ...previous, decision: command.decision };
  return { reviews: { ...state.reviews, [photo.id]: next },
    index: command.type === 'decision' ? Math.min(photos.length - 1, state.index + 1) : state.index,
    undo: [...state.undo.slice(-99), { id: photo.id, previous, selectedIndex: state.index }] };
}

/** Validate disk data; never allow malformed values to become application state. */
export function readReview(json: string | null, photos: Photo[]): ReviewState {
  if (!json) return { index: 0, reviews: {}, undo: [] };
  const data: unknown = JSON.parse(json);
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('reviews' in data) || !data.reviews || typeof data.reviews !== 'object') throw new Error('Saved review has an unsupported format.');
  const reviews: Reviews = {};
  for (const [id, entry] of Object.entries(data.reviews)) {
    if (!entry || typeof entry !== 'object' || !['keep', 'reject', 'unreviewed'].includes(entry.decision) || !Number.isInteger(entry.stars) || entry.stars < 0 || entry.stars > 5) throw new Error('Saved review contains invalid ratings.');
    reviews[id] = { decision: entry.decision, stars: entry.stars };
  }
  const selectedID = 'selectedID' in data ? data.selectedID : null;
  return { index: Math.max(0, photos.findIndex(p => p.id === selectedID)), reviews, undo: [] };
}
export function serializeReview(state: ReviewState, photos: Photo[]): string {
  return JSON.stringify({ version: 1, selectedID: photos[state.index]?.id ?? null, reviews: state.reviews } satisfies ReviewDocument);
}
