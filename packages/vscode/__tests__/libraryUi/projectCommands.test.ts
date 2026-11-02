// Tests which project menu commands apply to a ready, a broken, an in-library and an external project, and the open project's menu order.
import { OPEN_PROJECT_PANEL, OPEN_PROJECT_REMOVE, PROJECT_COMMANDS, canApplyProjectCommand, isSidebarProjectCommand } from '../../src/libraryUi/projectCommands';

const commands = (row: { kind: 'ready' | 'broken'; external: boolean }): string[] =>
  PROJECT_COMMANDS.filter((c) => canApplyProjectCommand(c.command, row)).map((c) => c.command);

describe('canApplyProjectCommand', () => {
  it('offers removal only for external folders', () => {
    expect(commands({ kind: 'ready', external: false })).not.toContain('labshelf.writing.removeProject');
    expect(commands({ kind: 'ready', external: true })).toContain('labshelf.writing.removeProject');
  });

  it('offers a broken project only reveal and remove', () => {
    expect(commands({ kind: 'broken', external: true })).toEqual(['labshelf.writing.reveal', 'labshelf.writing.removeProject']);
    expect(commands({ kind: 'broken', external: false })).toEqual(['labshelf.writing.reveal']);
  });

  it('rejects a command that is not on the menu', () => {
    expect(canApplyProjectCommand('workbench.action.quit', { kind: 'ready', external: true })).toBe(false);
  });
});

describe('OPEN_PROJECT_PANEL', () => {
  it('groups downloads and exports as chips and leaves out what the editor already offers', () => {
    expect(OPEN_PROJECT_PANEL.map((s) => s.title)).toEqual(['Download', 'Export', 'Versions', 'Project']);
    expect(OPEN_PROJECT_PANEL.filter((s) => s.layout === 'chips').map((s) => s.title)).toEqual(['Download', 'Export']);
    const list = OPEN_PROJECT_PANEL.flatMap((s) => s.commands.map((c) => c.command));
    for (const shown of ['labshelf.writing.showHistory', 'labshelf.writing.closeProject', 'labshelf.writing.openProject']) expect(list).not.toContain(shown);
    expect(isSidebarProjectCommand('labshelf.writing.exportHtml')).toBe(true);
    expect(isSidebarProjectCommand(OPEN_PROJECT_REMOVE.command)).toBe(true);
  });

  it('applies to a ready project and not to a broken one', () => {
    expect(canApplyProjectCommand('labshelf.writing.exportWord', { kind: 'ready', external: false })).toBe(true);
    expect(canApplyProjectCommand('labshelf.writing.exportWord', { kind: 'broken', external: false })).toBe(false);
  });
});
