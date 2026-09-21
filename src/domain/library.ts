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
export const isRawFile = (name: string) => RAW.has(extension(name));
export const reviewFor = (reviews: Reviews, id: string): Review => Object.hasOwn(reviews, id) ? reviews[id] : EMPTY_REVIEW;
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

/** Try JPEG companions first, then other rendered files, then RAWs. */
export function previewCandidates(photo: Photo): string[] {
  const priority = (name: string) => ['jpg', 'jpeg'].includes(extension(name)) ? 0 : isRawFile(name) ? 2 : 1;
  return photo.files.map(file => file.name).sort((a, b) => priority(a) - priority(b) || compare(a, b));
}

export type ExportPlan = { names: string[]; totalBytes: number; unreviewed: number; keptWithoutRaw: number };

/** Only explicit keeps qualify. Stars never imply keep; JPEG companions stay behind. */
export function planKeeperExport(photos: Photo[], reviews: Reviews): ExportPlan {
  const plan: ExportPlan = { names: [], totalBytes: 0, unreviewed: 0, keptWithoutRaw: 0 };
  const usedNames = new Set<string>();
  for (const photo of photos) {
    const review = reviewFor(reviews, photo.id);
    if (review.decision === 'unreviewed') plan.unreviewed++;
    if (review.decision !== 'keep') continue;
    const rawFiles = photo.files.filter(file => isRawFile(file.name));
    if (!rawFiles.length) plan.keptWithoutRaw++;
    for (const file of rawFiles) {
      if (!file.name || /[/\\\u0000]/.test(file.name) || file.name === '.' || file.name === '..') throw new Error('Export requires files directly inside the source folder.');
      const normalized = file.name.normalize('NFC').toLowerCase();
      if (usedNames.has(normalized)) throw new Error(`Conflicting RAW filenames: ${file.name}`);
      if (!Number.isSafeInteger(file.size) || file.size < 0 || !Number.isSafeInteger(plan.totalBytes + file.size)) throw new Error(`Invalid file size: ${file.name}`);
      usedNames.add(normalized);
      plan.names.push(file.name);
      plan.totalBytes += file.size;
    }
  }
  return plan;
}

type UndoEntry = { id: string; previous: Review; selectedIndex: number };
export type ReviewState = { index: number; reviews: Reviews; undo: UndoEntry[] };
export function applyCommand(state: ReviewState, command: Command, photos: Photo[]): ReviewState {
  const photo = photos[state.index];
  if (!photo) return state;
  if (command.type === 'move') {
    if (!Number.isSafeInteger(command.delta)) return state;
    const index = Math.max(0, Math.min(photos.length - 1, state.index + command.delta));
    return index === state.index ? state : { ...state, index };
  }
  if (command.type === 'undo') {
    const entry = state.undo.at(-1);
    if (!entry) return state;
    return { reviews: { ...state.reviews, [entry.id]: entry.previous }, index: entry.selectedIndex, undo: state.undo.slice(0, -1) };
  }
  if (command.type === 'rate' && !Number.isFinite(command.stars)) return state;
  const previous = reviewFor(state.reviews, photo.id);
  const next = command.type === 'rate' ? { ...previous, stars: Math.max(0, Math.min(5, Math.round(command.stars))) } : { ...previous, decision: command.decision };
  if (command.type === 'rate' && next.stars === previous.stars) return state;
  // A held key at the end of the folder must not erase useful undo history.
  if (command.type === 'decision' && next.decision === previous.decision && state.index === photos.length - 1) return state;
  return { reviews: { ...state.reviews, [photo.id]: next },
    index: command.type === 'decision' ? Math.min(photos.length - 1, state.index + 1) : state.index,
    undo: [...state.undo.slice(-99), { id: photo.id, previous, selectedIndex: state.index }] };
}

/** Validate disk data; never allow malformed values to become application state. */
export function readReview(json: string | null, photos: Photo[]): ReviewState {
  if (!json) return { index: 0, reviews: {}, undo: [] };
  const data: unknown = JSON.parse(json);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('version' in data) || data.version !== 1 || !('reviews' in data) || !data.reviews || typeof data.reviews !== 'object' || Array.isArray(data.reviews)) throw new Error('Saved review has an unsupported format.');
  const entries: [string, Review][] = [];
  for (const [id, entry] of Object.entries(data.reviews)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !['keep', 'reject', 'unreviewed'].includes(entry.decision) || !Number.isInteger(entry.stars) || entry.stars < 0 || entry.stars > 5) throw new Error('Saved review contains invalid ratings.');
    entries.push([id, { decision: entry.decision, stars: entry.stars }]);
  }
  const selectedID = 'selectedID' in data ? data.selectedID : null;
  if (selectedID !== null && typeof selectedID !== 'string') throw new Error('Saved review contains an invalid selection.');
  return { index: Math.max(0, photos.findIndex(p => p.id === selectedID)), reviews: Object.fromEntries(entries), undo: [] };
}
export function serializeReview(state: ReviewState, photos: Photo[]): string {
  return JSON.stringify({ version: 1, selectedID: photos[state.index]?.id ?? null, reviews: state.reviews } satisfies ReviewDocument);
}
