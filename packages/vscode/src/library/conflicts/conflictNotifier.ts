// Decides when the conflict notification is shown: once per distinct non-zero count, so a repeated scan stays quiet.

export function conflictMessage(count: number): string {
  return count === 1 ? "1 file has a conflicting copy" : `${count} files have conflicting copies`;
}

export class ConflictNotifier {
  private lastSeen = 0;

  /** @returns true when `count` is non-zero and differs from the count last shown or seen. */
  shouldNotify(count: number): boolean {
    const changed = count > 0 && count !== this.lastSeen;
    this.lastSeen = count;
    return changed;
  }

  /** Records a count the user already knows about, such as what remains after an interrupted resolve. */
  markSeen(count: number): void {
    this.lastSeen = count;
  }
}
