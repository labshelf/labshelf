// Tests which project menu commands apply to a ready, a broken, an in-library and an external project.
import { PROJECT_COMMANDS, projectCommandApplies } from '../../../src/ui/library/projectCommands';

const commands = (row: { kind: 'ready' | 'broken'; external: boolean }): string[] =>
  PROJECT_COMMANDS.filter((c) => projectCommandApplies(c.command, row)).map((c) => c.command);

describe('projectCommandApplies', () => {
  it('offers removal only for external folders', () => {
    expect(commands({ kind: 'ready', external: false })).not.toContain('labshelf.writing.removeProject');
    expect(commands({ kind: 'ready', external: true })).toContain('labshelf.writing.removeProject');
  });

  it('offers a broken project only reveal and remove', () => {
    expect(commands({ kind: 'broken', external: true })).toEqual(['labshelf.writing.reveal', 'labshelf.writing.removeProject']);
    expect(commands({ kind: 'broken', external: false })).toEqual(['labshelf.writing.reveal']);
  });

  it('rejects a command that is not on the menu', () => {
    expect(projectCommandApplies('workbench.action.quit', { kind: 'ready', external: true })).toBe(false);
  });
});
