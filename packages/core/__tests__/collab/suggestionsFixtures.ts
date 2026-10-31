/** Shared fixtures for the suggestion tests: threads, suggestion records, comments.qmd parsing and doc replication. */
import * as Y from "yjs";
import { type CommentThread } from "../../src/collab/comments";
import { parseCommentsQmd } from "../../src/collab/commentsQmd";
import { type Suggestion } from "../../src/collab/suggestions";

export const CREATED = "2026-10-20T08:00:00.000Z";

export const thread = (id: string): CommentThread => ({
  id,
  file: "chapters/intro.tex",
  anchor: { quote: "a strong baseline", prefix: "we use ", suffix: " on" },
  comments: [{ id: `${id}-c1`, author: "Ana", body: "Which one?", createdAt: "2026-10-16T09:12:00.000Z" }],
  resolved: false,
});

export const sugIns = (id: string, created: string, overrides: Partial<Suggestion> = {}): Suggestion => ({
  id, file: "main.tex", kind: "insert", anchor: { quote: "brand new words", prefix: "so we add ", suffix: " here" }, author: "Ana", created, ...overrides,
});

export const sugDel = (id: string, created: string, overrides: Partial<Suggestion> = {}): Suggestion => ({
  id, file: "main.tex", kind: "delete", anchor: { quote: "", prefix: "so we cut ", suffix: " there" }, text: "old words", author: "Bo", created, ...overrides,
});

export function parsed(text: string) {
  const doc = parseCommentsQmd(text);
  expect(doc).toBeDefined();
  return doc!;
}

export function sortedIds(suggestions: readonly Suggestion[]): string[] {
  return suggestions.map((each) => each.id).sort();
}

export const byId = (suggestions: readonly Suggestion[]): Suggestion[] => [...suggestions].sort((a, b) => a.id.localeCompare(b.id));

export function replicate(from: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(from));
  return copy;
}
