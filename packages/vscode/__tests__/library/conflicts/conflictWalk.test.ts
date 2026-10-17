import type { ConflictCopy, ConflictResolution } from '@labshelf/core';
import { walkConflicts } from '../../../src/library/conflicts/conflictWalk';

const copies: ConflictCopy[] = ['a', 'b', 'c'].map((id) => ({
  paperId: id, original: `/l/${id}/f`, copy: `/l/${id}/f.conflict`, tool: 'dropbox',
}));

function deps(answers: Array<ConflictResolution | undefined>, failOn?: string) {
  const applied: string[] = [];
  const failures: string[] = [];
  return {
    applied, failures,
    walk: {
      ask: async () => answers.shift(),
      apply: async (copy: ConflictCopy, resolution: ConflictResolution) => {
        if (copy.paperId === failOn) { throw new Error('boom'); }
        applied.push(`${copy.paperId}:${resolution}`);
      },
      onFailure: (copy: ConflictCopy) => { failures.push(copy.paperId); },
    },
  };
}

describe('walkConflicts', () => {
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
