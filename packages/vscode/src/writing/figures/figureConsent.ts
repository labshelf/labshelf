// Asks once per project and exact command before a figure command from labshelf.yaml runs, and remembers the answer on this machine.
import * as vscode from "vscode";

const CONFIRMED_KEY = "labshelf.writing.confirmedFigureCommands";
const RUN = "Run Command";

type Confirmed = Record<string, string[]>;

/** True when the user has confirmed this exact command for this project, now or earlier. */
export async function askFigureCommand(state: vscode.Memento, folder: string, command: string): Promise<boolean> {
  const confirmed = state.get<Confirmed>(CONFIRMED_KEY) ?? {};
  if (confirmed[folder]?.includes(command)) { return true; }
  const answer = await vscode.window.showWarningMessage(
    `Run "${command}" in ${folder}?`,
    {
      modal: true,
      detail: "This runs code from labshelf.yaml on your computer. LabShelf asks again when the command changes.",
    },
    RUN,
  );
  if (answer !== RUN) { return false; }
  // workspaceState stays on this machine, so a project synced from elsewhere never arrives already confirmed.
  await state.update(CONFIRMED_KEY, { ...confirmed, [folder]: [...confirmed[folder] ?? [], command] });
  return true;
}
