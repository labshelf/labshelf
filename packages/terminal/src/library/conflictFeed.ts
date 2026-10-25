// Holds the library's unresolved sync conflict copies and tells the UI when they change.
import type { ConflictCopy } from "@labshelf/core";

export class ConflictFeed {
  private current: ConflictCopy[] = [];
  private readonly listeners: Array<() => void> = [];

  get copies(): readonly ConflictCopy[] {
    return this.current;
  }

  set(copies: ConflictCopy[]): void {
    this.current = copies;
    this.listeners.forEach((listener) => listener());
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }
}
