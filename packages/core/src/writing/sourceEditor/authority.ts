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

/**
 * Positions inside the authority are in the LF-normalised text the editor sees; the host's line break
 * is restored at the edges, so `receive` returns and `external` takes offsets of the host document.
 * Rebasing follows collab's rule: a late client change maps after the changes accepted before it.
 */
export function createSourceAuthority(initial: { text: string; lineBreak: "\n" | "\r\n"; historyLimit?: number }): SourceAuthority {
  const crlf = initial.lineBreak === "\r\n";
  const historyLimit = Math.max(0, initial.historyLimit ?? DEFAULT_HISTORY_LIMIT);
  const toLf = (host: string): string => (crlf ? host.replace(/\r\n/g, "\n") : host);
  const toHost = (lf: string): string => (crlf ? lf.split("\n").join("\r\n") : lf);

  let doc = lfText(toLf(initial.text));
  let version = 0;
  const history: Recorded[] = [];

  /** LF offset to host offset: each line break before it is one character longer in a CRLF host. */
  const hostOffset = (pos: number): number => (crlf ? pos + doc.lineAt(pos).number - 1 : pos);

  /** Host offset to LF offset; an offset between "\r" and "\n" falls back to the end of its line. */
  const lfOffset = (pos: number): number => {
    if (!crlf) return pos;
    let low = 1;
    let high = doc.lines;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (doc.line(mid).from + mid - 1 <= pos) low = mid;
      else high = mid - 1;
    }
    const line = doc.line(low);
    return Math.min(line.to, pos - (low - 1));
  };

  const record = (clientID: string, set: ChangeSet): void => {
    history.push({ clientID, set, changes: listChanges(set) });
    if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
    doc = set.apply(doc);
    version += 1;
  };

  const oldestVersion = (): number => version - history.length;

  return {
    get version() { return version; },

    text: () => toHost(doc.toString()),

    receive(baseVersion, updates) {
      if (!Number.isInteger(baseVersion) || baseVersion < oldestVersion() || baseVersion > version) return undefined;
      const missed = history.slice(baseVersion - oldestVersion());
      // Each client update sits on the previous one; validate all against their own base before applying any.
      let sets: ChangeSet[] = [];
      let clientLength = missed[0]?.set.length ?? doc.length;
      for (const update of updates) {
        let set: ChangeSet;
        try {
          set = ChangeSet.of(update.changes.map((c) => ({ from: c.from, to: c.to, insert: lfText(c.insert) })), clientLength);
        } catch {
          return undefined;
        }
        sets.push(set);
        clientLength = set.newLength;
      }
      // Map over each missed update in turn, as a collab client rebases its unconfirmed updates, so both sides converge.
      for (const { set: missedSet } of missed) {
        let over = missedSet;
        sets = sets.map((local) => {
          const rebased = local.map(over);
          over = over.map(local, true);
          return rebased;
        });
      }
      const accepted: TextChange[][] = [];
      updates.forEach((update, i) => {
        const rebased = sets[i]!;
        const hostChanges: TextChange[] = [];
        rebased.iterChanges((from, to, _fromB, _toB, inserted) => {
          hostChanges.push({ from: hostOffset(from), to: hostOffset(to), insert: toHost(inserted.toString()) });
        });
        accepted.push(hostChanges);
        record(update.clientID, rebased);
      });
      return accepted;
    },

    external(changes) {
      const set = ChangeSet.of(changes.map((c) => ({ from: lfOffset(c.from), to: lfOffset(c.to), insert: lfText(toLf(c.insert)) })), doc.length);
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
