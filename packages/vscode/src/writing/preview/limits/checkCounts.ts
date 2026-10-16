// Remembers the finding count of each project's last check so the preview can show it.

export class CheckCounts {
  private readonly counts = new Map<string, number>();
  private readonly listeners = new Set<(folder: string) => void>();

  record(folder: string, count: number): void {
    this.counts.set(folder, count);
    for (const listener of this.listeners) { listener(folder); }
  }

  /** Undefined until the project has been checked in this session. */
  get(folder: string): number | undefined {
    return this.counts.get(folder);
  }

  onChange(listener: (folder: string) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }
}
