// The source editor's authority for one document: the host text, its version and the recent updates, with late client updates rebased the way @codemirror/collab's reference authority does.
import { ChangeSet, Text } from "@codemirror/state";

export interface TextChange { from: number; to: number; insert: string }

export interface SourceUpdate { clientID: string; changes: TextChange[] }

export interface SourceAuthority {
  readonly version: number;
  text(): string;
  /** Applies a client's updates made on top of `baseVersion`; returns the accepted (rebased) changes to apply to the host document, or undefined when baseVersion is unknown and the client must resync. */
  receive(baseVersion: number, updates: readonly SourceUpdate[]): TextChange[][] | undefined;
  /** Records a change made to the host document by someone else (another editor, git, a collaborator). */
  external(changes: readonly TextChange[]): void;
  /** The updates after `version`, for a client that is behind. */
  since(version: number): SourceUpdate[];
}

const HOST_CLIENT_ID = "host";
const DEFAULT_HISTORY_LIMIT = 500;

interface Recorded { clientID: string; set: ChangeSet; changes: TextChange[] }

/** Builds a Text splitting on "\n" only, so a lone "\r" stays one character as the offsets assume. */
function lfText(lf: string): Text {
  return Text.of(lf.split("\n"));
}

/** CodeMirror reports each change against the text before the transaction, which is what the authority and the helper expect. */
export function listChanges(set: ChangeSet): TextChange[] {
  const out: TextChange[] = [];
  set.iterChanges((from, to, _fromB, _toB, inserted) => out.push({ from, to, insert: inserted.toString() }));
  return out;
}

interface HostText {
  toLf(host: string): string;
  toHost(lf: string): string;
  /** LF offset to host offset: each line break before it is one character longer in a CRLF host. */
  hostOffset(pos: number): number;
  /** Host offset to LF offset; an offset between "\r" and "\n" falls back to the end of its line. */
  lfOffset(pos: number): number;
}

/** Converts text and offsets between the LF text of `doc()` and the host's line break. */
function createHostText(crlf: boolean, doc: () => Text): HostText {
  return {
    toLf: (host) => (crlf ? host.replace(/\r\n/g, "\n") : host),
    toHost: (lf) => (crlf ? lf.split("\n").join("\r\n") : lf),
    hostOffset: (pos) => (crlf ? pos + doc().lineAt(pos).number - 1 : pos),
    lfOffset(pos) {
      if (!crlf) return pos;
      const text = doc();
      let low = 1;
      let high = text.lines;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (text.line(mid).from + mid - 1 <= pos) low = mid;
        else high = mid - 1;
      }
      return Math.min(text.line(low).to, pos - (low - 1));
    },
  };
}

/** Builds each client update's change set on top of the previous one; undefined when any does not fit its own base. */
function parseClientSets(updates: readonly SourceUpdate[], baseLength: number): ChangeSet[] | undefined {
  const sets: ChangeSet[] = [];
  let length = baseLength;
  for (const update of updates) {
    try {
      const set = ChangeSet.of(update.changes.map((c) => ({ from: c.from, to: c.to, insert: lfText(c.insert) })), length);
      sets.push(set);
      length = set.newLength;
    } catch {
      return undefined;
    }
  }
  return sets;
}

/** Maps the client sets over each missed update in turn, as a collab client rebases its unconfirmed updates, so both sides converge. */
function rebaseOver(sets: ChangeSet[], missed: readonly Recorded[]): ChangeSet[] {
  let rebasedSets = sets;
  for (const { set: missedSet } of missed) {
    let over = missedSet;
    rebasedSets = rebasedSets.map((local) => {
      const rebased = local.map(over);
      over = over.map(local, true);
      return rebased;
    });
  }
  return rebasedSets;
}

/** The changes of `set` in offsets and line breaks of the host document, which must still be in the state `set` applies to. */
function toHostChanges(set: ChangeSet, host: HostText): TextChange[] {
  const changes: TextChange[] = [];
  set.iterChanges((from, to, _fromB, _toB, inserted) => {
    changes.push({ from: host.hostOffset(from), to: host.hostOffset(to), insert: host.toHost(inserted.toString()) });
  });
  return changes;
}

/**
 * Positions inside the authority are in the LF-normalised text the editor sees; the host's line break
 * is restored at the edges, so `receive` returns and `external` takes offsets of the host document.
 * Rebasing follows collab's rule: a late client change maps after the changes accepted before it.
 */
export function createSourceAuthority(initial: { text: string; lineBreak: "\n" | "\r\n"; historyLimit?: number }): SourceAuthority {
  const historyLimit = Math.max(0, initial.historyLimit ?? DEFAULT_HISTORY_LIMIT);
  let doc: Text;
  const host = createHostText(initial.lineBreak === "\r\n", () => doc);
  doc = lfText(host.toLf(initial.text));
  let version = 0;
  const history: Recorded[] = [];

  const record = (clientID: string, set: ChangeSet): void => {
    history.push({ clientID, set, changes: listChanges(set) });
    if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
    doc = set.apply(doc);
    version += 1;
  };

  const oldestVersion = (): number => version - history.length;

  return {
    get version() { return version; },

    text: () => host.toHost(doc.toString()),

    receive(baseVersion, updates) {
      if (!Number.isInteger(baseVersion) || baseVersion < oldestVersion() || baseVersion > version) return undefined;
      const missed = history.slice(baseVersion - oldestVersion());
      // Each client update sits on the previous one; validate all against their own base before applying any.
      const sets = parseClientSets(updates, missed[0]?.set.length ?? doc.length);
      if (!sets) return undefined;
      const rebasedSets = rebaseOver(sets, missed);
      return updates.map((update, i) => {
        const rebased = rebasedSets[i]!;
        const hostChanges = toHostChanges(rebased, host);
        record(update.clientID, rebased);
        return hostChanges;
      });
    },

    external(changes) {
      const set = ChangeSet.of(changes.map((c) => ({ from: host.lfOffset(c.from), to: host.lfOffset(c.to), insert: lfText(host.toLf(c.insert)) })), doc.length);
      record(HOST_CLIENT_ID, set);
    },

    since(sinceVersion) {
      if (sinceVersion < oldestVersion() || sinceVersion > version) {
        throw new RangeError(`source authority: version ${sinceVersion} is outside the kept history (${oldestVersion()} to ${version}); resync from text()`);
      }
      return history.slice(sinceVersion - oldestVersion()).map((r) => ({ clientID: r.clientID, changes: r.changes.map((c) => ({ ...c })) }));
    },
  };
}
