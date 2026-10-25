// Tests which project menu commands apply to a ready, a broken, an in-library and an external project, and the open project's menu order.
import { OPEN_PROJECT_COMMANDS, PROJECT_COMMANDS, projectCommandApplies } from '../../src/libraryUi/projectCommands';

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

describe('OPEN_PROJECT_COMMANDS', () => {
  it('leads with publishing, then downloads and exports, a copy, the row commands, history and Close Project last', () => {
    const list = OPEN_PROJECT_COMMANDS.map((c) => c.command);
    expect(list.slice(0, 2)).toEqual(['labshelf.templates.publish', 'labshelf.writing.downloadPdf']);
    expect(list).toContain('labshelf.writing.markVersion');
    expect(list).toContain('labshelf.writing.showHistory');
    expect(list).not.toContain('labshelf.writing.openProject');
    expect(list.filter((c) => c === 'labshelf.templates.publish')).toHaveLength(1);
    expect(list[list.length - 1]).toBe('labshelf.writing.closeProject');
  });

  it('applies to a ready project and not to a broken one', () => {
    expect(projectCommandApplies('labshelf.writing.exportWord', { kind: 'ready', external: false })).toBe(true);
    expect(projectCommandApplies('labshelf.writing.exportWord', { kind: 'broken', external: false })).toBe(false);
  });
});
