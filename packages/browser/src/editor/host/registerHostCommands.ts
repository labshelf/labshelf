// Registers the editor page's host commands in the workbench, where the worker extension host reaches them through executeCommand.
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import type { HostCommand } from "./editorHostCommands";

/** Call before the extensions register, so the web build finds the commands when it activates. */
export function registerHostCommands(commands: Record<string, HostCommand>): void {
  for (const [id, run] of Object.entries(commands)) {
    // INVARIANT: the page lives as long as the workbench, so the registrations are never disposed.
    CommandsRegistry.registerCommand(id, (_accessor, ...args: unknown[]) => run(...args));
  }
}
