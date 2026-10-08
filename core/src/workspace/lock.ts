type LockEntry = {
  tail: Promise<void>;
  holder: string | null;
  pending: number;
};

/** In-process FIFO mutexes. Different paths remain independent. */
export class FileLocks {
  readonly #entries = new Map<string, LockEntry>();

  async acquire(relPath: string, holder: string): Promise<() => void> {
    let entry = this.#entries.get(relPath);
    if (entry === undefined) {
      entry = { tail: Promise.resolve(), holder: null, pending: 0 };
      this.#entries.set(relPath, entry);
    }
    const previous = entry.tail;
    let unlock!: () => void;
    entry.tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    entry.pending += 1;
    await previous;
    entry.holder = holder;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.holder = null;
      entry.pending -= 1;
      unlock();
      if (entry.pending === 0) this.#entries.delete(relPath);
    };
  }

  isHeld(relPath: string): boolean {
    return this.#entries.get(relPath)?.holder != null;
  }
}
