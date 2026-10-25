// Executes validated Space sidebar actions through the active library's store.
import * as vscode from "vscode";
import type { ILogger, SpaceStore, SpacesHostPort } from "@labshelf/core";
import type { SidebarSpaceMessage } from "./messages.js";

export interface SidebarSpacesDep {
  current(): { store: SpaceStore; port: SpacesHostPort; logger: ILogger } | undefined;
  onDidChange: vscode.Event<void>;
  createSpace(): Promise<string | undefined>;
}

async function askName(prompt: string, value?: string): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({ prompt, ...(value === undefined ? {} : { value }),
    validateInput: (text) => text.trim() ? undefined : "Enter a name." });
  return name?.trim() || undefined;
}

async function run(m: SidebarSpaceMessage, spaces: SidebarSpacesDep): Promise<void> {
  const current = spaces.current();
  if (!current) return;
  const { store, port } = current;
  const ask = async (prompt: string, value?: string): Promise<string | undefined> => {
    const name = await askName(prompt, value);
    if (spaces.current()?.store !== store) throw new Error("The library changed while naming the Space or folder");
    return name;
  };
  switch (m.action) {
    case "openCatalog": await port.openCatalog(); break;
    case "newSpace": await spaces.createSpace(); break;
    case "openSpace": await port.openSpace(m.id, m.folder ? "papers" : undefined); break;
    case "openPaper": await port.openPaper(m.id); break;
    case "deleteSpace": await store.deleteSpace(m.id); break;
    case "renameSpace": {
      const result = await store.read(m.id);
      if (result.state !== "ready") return;
      const name = await ask("Space name", result.space.name);
      if (name) await store.renameSpace(m.id, name);
      break;
    }
    case "newFolder": { const name = await ask("Folder name"); if (name) await store.createFolder(m.spaceId, name, m.parent); break; }
    case "renameFolder": {
      const name = await ask("Folder name");
      if (name) await store.renameFolder(m.spaceId, m.folder, name);
      break;
    }
    case "deleteFolder": await store.deleteFolder(m.spaceId, m.folder); break;
    case "dropPapers": await store.addPapers(m.spaceId, m.paperIds, m.folder); break;
    case "removeReference": await store.removePaper(m.spaceId, m.paperId); break;
  }
}

export async function handleSidebarSpaceMessage(m: SidebarSpaceMessage, spaces: SidebarSpacesDep): Promise<void> {
  const logger = spaces.current()?.logger;
  try { await run(m, spaces); }
  catch (error) {
    await logger?.error("sidebar.spaces", error, { action: m.action });
    await vscode.window.showErrorMessage(`Space action failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
