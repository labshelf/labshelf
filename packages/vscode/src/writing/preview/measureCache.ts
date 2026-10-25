// Remembers what was measured of a built root until its next build, so switching editors does not measure again.
export class MeasureCache {
  private readonly measures = new Map<string, Promise<unknown>>();

  /** The measure of a root, taken once; a failed measure is forgotten so the next call tries again. */
  get<T>(projectFolder: string, root: string, kind: string, measure: () => Promise<T>): Promise<T> {
    const key = `${projectFolder}\0${root}\0${kind}`;
    const known = this.measures.get(key);
    if (known) { return known as Promise<T>; }
    const taken = measure();
    this.measures.set(key, taken);
    taken.catch(() => { if (this.measures.get(key) === taken) { this.measures.delete(key); } });
    return taken;
  }

  /** Forgets the measures of one root, whose build finished. */
  invalidate(projectFolder: string, root: string): void {
    const prefix = `${projectFolder}\0${root}\0`;
    for (const key of this.measures.keys()) { if (key.startsWith(prefix)) { this.measures.delete(key); } }
  }

  clear(): void {
    this.measures.clear();
  }
}
