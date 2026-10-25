// Checks the choices offered for conflict copies.
import type { ConflictCopy, ConflictResolution } from '@labshelf/core';
import {
  listConflictChoices,
  formatToolName,
  ConflictNotifier,
  describeConflicts,
  walkConflicts,
} from '../../../src/library/conflicts/conflictHandling';

const copy = (name: string): ConflictCopy => ({
  owner: { kind: 'paper', id: 'p1' }, original: `/lib/papers/p1/${name}`, copy: `/lib/papers/p1/${name}.sync-conflict`, tool: 'syncthing',
});

describe('listConflictChoices', () => {
  it("offers the content-match question's three choices", () => {
    const content = { ...copy("main.tex"), owner: { kind: "project" as const, id: "draft" }, match: "similar", tool: "unknown" } as ConflictCopy;
    expect(listConflictChoices(content).map((choice) => choice.label)).toEqual(["Merge Automatically", "Merge Myself", "Not a Version"]);
    expect(listConflictChoices(content).map((choice) => choice.resolution)).toEqual(["mergeAutomatically", "mergeMyself", "notAVersion"]);
  });

  it('offers the three choices for a file', () => {
    expect(listConflictChoices(copy('paper.pdf')).map((c) => c.label)).toEqual(['Keep mine', 'Keep the other', 'Keep both']);
  });

  it('omits Keep both for metadata.yaml', () => {
    expect(listConflictChoices(copy('metadata.yaml')).map((c) => c.resolution)).toEqual(['keepMine', 'keepOther']);
  });
});

describe('formatToolName', () => {
  it('names the sync tool', () => {
    expect(formatToolName('dropbox')).toBe('Dropbox');
  });
});

describe('ConflictNotifier', () => {
  it('notifies for a new non-zero count and stays quiet for a repeat', () => {
    const notifier = new ConflictNotifier();
    expect(notifier.shouldNotify(0)).toBe(false);
    expect(notifier.shouldNotify(2)).toBe(true);
    expect(notifier.shouldNotify(2)).toBe(false);
    expect(notifier.shouldNotify(3)).toBe(true);
  });

  it('notifies again after the count dropped to zero', () => {
    const notifier = new ConflictNotifier();
    notifier.shouldNotify(2);
    notifier.shouldNotify(0);
    expect(notifier.shouldNotify(2)).toBe(true);
  });

  it('does not notify for a count the user already saw', () => {
    const notifier = new ConflictNotifier();
    notifier.shouldNotify(3);
    notifier.markSeen(1);
    expect(notifier.shouldNotify(1)).toBe(false);
  });
});

describe('describeConflicts', () => {
  it('uses the singular for one file', () => {
    expect(describeConflicts(1)).toBe('1 file has a conflicting copy');
    expect(describeConflicts(2)).toBe('2 files have conflicting copies');
  });
});

const copies: ConflictCopy[] = ['a', 'b', 'c'].map((id) => ({
  owner: { kind: 'paper', id }, original: `/l/${id}/f`, copy: `/l/${id}/f.conflict`, tool: 'dropbox',
}));

function deps(answers: Array<ConflictResolution | "mergeMyself" | undefined>, failOn?: string) {
  const applied: string[] = [];
  const failures: string[] = [];
  return {
    applied, failures,
    walk: {
      ask: async () => answers.shift(),
      mergeMyself: async () => undefined,
      apply: async (copy: ConflictCopy, resolution: ConflictResolution) => {
        if (copy.owner.id === failOn) { throw new Error('boom'); }
        applied.push(`${copy.owner.id}:${resolution}`);
      },
      onFailure: (copy: ConflictCopy) => { failures.push(copy.owner.id); },
    },
  };
}

describe('walkConflicts', () => {
  it('leaves manually opened copies unresolved', async () => {
    const d = deps(['mergeMyself', 'keepMine', 'keepMine']);
    expect(await walkConflicts(copies, d.walk)).toBe(1);
    expect(d.applied).toEqual(['b:keepMine', 'c:keepMine']);
  });

  it('applies each choice and leaves none remaining', async () => {
    const d = deps(['keepMine', 'keepOther', 'keepBoth']);
    expect(await walkConflicts(copies, d.walk)).toBe(0);
    expect(d.applied).toEqual(['a:keepMine', 'b:keepOther', 'c:keepBoth']);
  });

  it('stops at the first dismissed question and counts the rest as remaining', async () => {
    const d = deps(['keepMine', undefined]);
    expect(await walkConflicts(copies, d.walk)).toBe(2);
    expect(d.applied).toEqual(['a:keepMine']);
  });

  it('reports a failed copy, keeps it remaining and goes on', async () => {
    const d = deps(['keepMine', 'keepMine', 'keepMine'], 'b');
    expect(await walkConflicts(copies, d.walk)).toBe(1);
    expect(d.failures).toEqual(['b']);
    expect(d.applied).toEqual(['a:keepMine', 'c:keepMine']);
  });
});
