// Validates the shared paper-id payload carried by Library drag operations.
export const PAPER_DRAG_MIME = "application/x-labshelf-papers";
export function parsePaperDragPayload(payload: string): string[] {
  try {
    const ids: unknown = JSON.parse(payload);
    return Array.isArray(ids) && ids.every(id => typeof id === "string" && id.trim()) ? ids : [];
  } catch {
    return [];
  }
}
