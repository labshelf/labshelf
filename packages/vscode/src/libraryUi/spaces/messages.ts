// Validates the Space actions sent across the sidebar webview boundary.
export type SidebarSpaceMessage = { type: "spaceAction" } & (
  | { action: "openCatalog" | "newSpace" }
  | { action: "openSpace"; id: string; folder?: string }
  | { action: "openPaper" | "renameSpace" | "deleteSpace"; id: string }
  | { action: "newFolder"; spaceId: string; parent?: string }
  | { action: "renameFolder" | "deleteFolder"; spaceId: string; folder: string }
  | { action: "dropPapers"; spaceId: string; folder?: string; paperIds: string[] }
  | { action: "removeReference"; spaceId: string; paperId: string }
);

const id = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const spaceId = (value: unknown): boolean => id(value) && !value.startsWith(".") && !/[/\\]/.test(value);
const optionalId = (value: unknown): boolean => value === undefined || id(value);

export function isSidebarSpaceMessage(m: Record<string, unknown>): boolean {
  switch (m["action"]) {
    case "openCatalog": case "newSpace": return true;
    case "openSpace": return spaceId(m["id"]) && optionalId(m["folder"]);
    case "openPaper": return id(m["id"]);
    case "renameSpace": case "deleteSpace": return spaceId(m["id"]);
    case "newFolder": return spaceId(m["spaceId"]) && optionalId(m["parent"]);
    case "renameFolder": case "deleteFolder": return spaceId(m["spaceId"]) && id(m["folder"]);
    case "removeReference": return spaceId(m["spaceId"]) && id(m["paperId"]);
    case "dropPapers": return spaceId(m["spaceId"]) && optionalId(m["folder"]) && Array.isArray(m["paperIds"])
      && m["paperIds"].length > 0 && m["paperIds"].every(id);
    default: return false;
  }
}
