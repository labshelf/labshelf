// Pins that the project menus mark exactly the commands package.json disables on the web host, and that the web host drops them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OPEN_PROJECT_COMMANDS, PROJECT_COMMANDS, hostCommands } from '../../../src/ui/library/projectCommands';

const manifest = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as {
  contributes: { commands: Array<{ command: string; enablement?: string }> };
};
const webDisabled = new Set(manifest.contributes.commands.filter((c) => c.enablement === '!isWeb').map((c) => c.command));

describe('desktop-only project commands', () => {
  it.each([...PROJECT_COMMANDS, ...OPEN_PROJECT_COMMANDS].map((c) => [c.command, c] as const))('%s is flagged as the manifest enables it', (_, c) => {
    expect(c.desktopOnly === true).toBe(webDisabled.has(c.command));
  });

  it('keeps every command on the desktop host and drops the desktop-only ones on the web host', () => {
    expect(hostCommands(OPEN_PROJECT_COMMANDS, true)).toEqual([...OPEN_PROJECT_COMMANDS]);
    const web = hostCommands(OPEN_PROJECT_COMMANDS, false).map((c) => c.command);
    expect(web).not.toContain('labshelf.writing.exportWord');
    expect(web).not.toContain('labshelf.templates.publish');
    expect(web).toContain('labshelf.writing.closeProject');
  });
});
