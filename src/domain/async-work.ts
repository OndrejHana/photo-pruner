export type SaveStatus = { state: 'saved' | 'saving' } | { state: 'failed'; error: unknown };

/** One active write and one latest pending value. Failed data stays available for retry. */
export class CoalescingWriter<T> {
  private pending: { value: T } | null = null;
  private active: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private write: (value: T) => Promise<void>;
  private status: (status: SaveStatus) => void;
  private delay: number;
  constructor(write: (value: T) => Promise<void>, status: (status: SaveStatus) => void, delay = 100) {
    this.write = write; this.status = status; this.delay = delay;
  }

  schedule(value: T) {
    this.pending = { value };
    this.status({ state: 'saving' });
    if (!this.active && !this.timer) this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => {}); // The status callback surfaces failures; flush callers also receive them.
    }, this.delay);
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.active) return this.active;
    if (!this.pending) return;
    this.status({ state: 'saving' });
    this.active = this.drain().finally(() => { this.active = null; });
    return this.active;
  }

  private async drain() {
    while (this.pending) {
      const current = this.pending;
      this.pending = null;
      try { await this.write(current.value); }
      catch (error) {
        this.pending ??= current;
        this.status({ state: 'failed', error });
        throw error;
      }
    }
    this.status({ state: 'saved' });
  }
}
