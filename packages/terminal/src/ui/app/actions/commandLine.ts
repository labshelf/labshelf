/** Runs the : command line: a small set of ex-style commands over the same actions the keys trigger. */
import { textInput } from "../../textInput.js";
import { ALL, SORT_LABEL } from "../types.js";
import type { App } from "../app.js";
import { submitPrompt } from "../input/index.js";
import { importInputs, targetFolder } from "./createAndRename.js";
import { login, syncNow } from "./driveSync.js";
import { setSort } from "./paperExportActions.js";

export function runCommand(app: App, line: string): void {
  const [name = "", ...args] = line.split(/\s+/).filter(Boolean);
  const rest = line.slice(name.length).trim();
  switch (name) {
    case "": return;
    case "q": case "quit": case "wq": void app.quit(); return;
    case "sync": case "s": void syncNow(app); return;
    case "reload": case "r": void app.ctx.store.reload().then(() => app.taskStatus.notify("Library reloaded")); return;
    case "help": case "h": app.overlay = { kind: "help", scroll: 0 }; return;
    case "login": void login(app); return;
    case "logout": void logout(app); return;
    case "export":
      if (!rest) { app.taskStatus.notify("Usage: :export <file.bib>", "warn"); return; }
      submitPrompt(app, { kind: "prompt", purpose: "export", title: "", input: textInput(rest), completions: [], targets: [] });
      return;
    case "mkdir":
      if (!rest) { app.taskStatus.notify("Usage: :mkdir <name>", "warn"); return; }
      submitPrompt(app, { kind: "prompt", purpose: "add", title: "", input: textInput(rest), completions: [], targets: [targetFolder(app), "folder"] });
      return;
    case "add":
      if (!rest) { app.taskStatus.notify("Usage: :add <pdf | folder | url | doi | arxiv id>", "warn"); return; }
      void importInputs(app, [rest], targetFolder(app));
      return;
    case "sort": return runSort(app, args);
    case "cd": return runCd(app, rest);
    case "where":
      app.taskStatus.notify(`Library: ${app.ctx.paths.root} · log: ${app.ctx.paths.layout.terminalLogPath()}`);
      return;
    default:
      app.taskStatus.notify(`Unknown command "${name}" — ? lists the keys`, "warn");
  }
}

async function logout(app: App): Promise<void> {
  await app.taskStatus.task("auth", "signing out", async () => {
    await app.ctx.drive.logout();
    app.taskStatus.notify("Signed out of Google Drive. The library stays on this computer.");
  });
}

function runSort(app: App, args: string[]): void {
  const key = (args[0] ?? "title") as keyof typeof SORT_LABEL;
  if (!(key in SORT_LABEL)) { app.taskStatus.notify(`Unknown sort key "${key}" (title, year, author, status, modified)`, "warn"); return; }
  setSort(app, args[1] === "desc" || args[1] === "reverse" ? `${key}!` : key);
}

function runCd(app: App, rest: string): void {
  const rel = rest.replace(/^papers\/?/, "").replace(/^\/+|\/+$/g, "");
  if (!app.ctx.store.collection(rel)) { app.taskStatus.notify(`No folder "${rest}"`, "warn"); return; }
  app.historyNav.jumpToFolder(rel === "" ? ALL : rel);
}
