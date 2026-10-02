export type PreviewRequest = { key: string; photoID: string; revision: string; names: string[] };
export type PreparedPreview = { key: string; uri: string | null; error: unknown | null; memoryReady: boolean };
type CachedPreview = PreparedPreview & { warmAttempted: boolean };

export const PREVIEW_CACHE_COUNT = 8;
export const PREVIEW_MEMORY_BYTES = 96 * 1024 * 1024;

/** Prepare both immediate neighbors before the second upcoming photo. */
export function previewPriorityIndices(index: number, count: number): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= count) return [];
  return [index, index + 1, index - 1, index + 2].filter(value => value >= 0 && value < count);
}

/** One native decode and one memory warm can run; unsent work always follows the latest selection. */
export class PreviewScheduler {
  private revision: string | null = null;
  private epoch = 0;
  private paused = true;
  private demand: PreviewRequest[] = [];
  private cache = new Map<string, CachedPreview>();
  private decoding = false;
  private warming = false;
  private decode: (request: PreviewRequest) => Promise<string>;
  private warm: (uri: string) => Promise<boolean>;
  private changed: () => void;

  constructor(decode: (request: PreviewRequest) => Promise<string>, warm: (uri: string) => Promise<boolean>, changed: () => void) {
    this.decode = decode; this.warm = warm; this.changed = changed;
  }

  get(key: string): Readonly<PreparedPreview> | null { return this.cache.get(key) ?? null; }

  update(revision: string, requests: PreviewRequest[]) {
    this.resetRevision(revision);
    this.paused = false;
    const seen = new Set<string>();
    this.demand = requests.filter(request => {
      if (request.revision !== revision || seen.has(request.key)) return false;
      seen.add(request.key);
      return true;
    }).slice(0, 4);
    // Recently selected windows stay useful for Undo without allowing an unbounded URI history.
    for (const request of this.demand.slice().reverse()) {
      const cached = this.cache.get(request.key);
      if (cached) { this.cache.delete(request.key); this.cache.set(request.key, cached); }
    }
    this.pumpDecode();
    this.pumpWarm();
  }

  pause() { this.paused = true; this.demand = []; }

  resetRevision(revision: string) {
    if (revision === this.revision) return;
    this.epoch++;
    this.revision = revision;
    this.cache.clear();
    this.pause();
  }

  retry(key: string) {
    // The native decoder is uncancellable. Suppress its old completion, then retry when it frees up.
    this.epoch++;
    this.cache.delete(key);
    this.pumpDecode();
    this.pumpWarm();
  }

  clear() {
    this.epoch++;
    this.revision = null;
    this.cache.clear();
    this.pause();
  }

  private remember(key: string, result: CachedPreview) {
    this.cache.delete(key);
    this.cache.set(key, result);
    while (this.cache.size > PREVIEW_CACHE_COUNT) {
      const candidate = [...this.cache.keys()].find(value => !this.demand.some(request => request.key === value));
      if (candidate === undefined) break;
      this.cache.delete(candidate);
    }
  }

  private pumpDecode() {
    if (this.paused || this.decoding) return;
    const request = this.demand.find(value => !this.cache.has(value.key));
    if (!request) return;
    this.decoding = true;
    const epoch = this.epoch;
    void (async () => {
      let result: CachedPreview;
      try { result = { key: request.key, uri: await this.decode(request), error: null, memoryReady: false, warmAttempted: false }; }
      catch (error) { result = { key: request.key, uri: null, error, memoryReady: false, warmAttempted: true }; }
      if (epoch === this.epoch && request.revision === this.revision) {
        this.remember(request.key, result);
        if (!this.paused) this.changed();
      }
      this.decoding = false;
      this.pumpDecode();
      this.pumpWarm();
    })();
  }

  private pumpWarm() {
    if (this.paused || this.warming) return;
    // Do not spend image-loader work on neighbors while the current native preview is unresolved.
    const current = this.demand[0];
    if (!current || !this.cache.has(current.key)) return;
    const request = this.demand.find(value => {
      const result = this.cache.get(value.key);
      return result?.uri && !result.warmAttempted;
    });
    if (!request) return;
    const cached = this.cache.get(request.key)!;
    this.warming = true;
    const epoch = this.epoch;
    void (async () => {
      let memoryReady = false;
      try { memoryReady = await this.warm(cached.uri!); }
      catch { /* Warming is optional. Image.onError owns visible image-load failures. */ }
      if (epoch === this.epoch && this.cache.get(request.key) === cached) {
        this.cache.set(request.key, { ...cached, memoryReady, warmAttempted: true });
        if (!this.paused) this.changed();
      }
      this.warming = false;
      this.pumpWarm();
    })();
  }
}
