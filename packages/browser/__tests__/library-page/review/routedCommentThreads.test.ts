// Routed comments use a shared project's live threads while its share is connected and the comments.json store otherwise.
import type { ProjectEntry, TextRange } from "@labshelf/core";
import type { CommentThreads } from "../../../src/library-page/review";
import { createRoutedCommentThreads } from "../../../src/library-page/review/routedCommentThreads";

const entry = { kind: "ready", folder: "/lib/p", settings: { id: "p" } } as unknown as ProjectEntry;

function fakeStore(label: string, ranges: TextRange[]) {
  const listeners = new Set<() => void>();
  const store = {
    threads: jest.fn(async () => [{ id: label }]),
    commentAnchorsFor: () => ({ subscribe: (listener: (r: TextRange[]) => void) => { listener(ranges); return () => undefined; } }),
    addComment: jest.fn(async () => undefined),
    reply: jest.fn(async () => undefined),
    resolve: jest.fn(async () => undefined),
    onDidChange: (listener: () => void) => { listeners.add(listener); return () => void listeners.delete(listener); },
  };
  return { store: store as unknown as CommentThreads & typeof store, listeners };
}

function setup() {
  const file = fakeStore("file", [{ start: 0, end: 1 }]);
  const live = fakeStore("live", [{ start: 5, end: 6 }]);
  let active: { comments: CommentThreads } | undefined;
  const changes = new Set<() => void>();
  const shares = { live: () => active, onChange: (l: () => void) => { changes.add(l); return () => void changes.delete(l); } };
  const routed = createRoutedCommentThreads({ files: file.store, shares: shares as never, session: { current: () => entry } });
  const setActive = (on: boolean): void => { active = on ? { comments: live.store } : undefined; changes.forEach((l) => l()); };
  return { file, live, routed, setActive };
}

describe("routed comment threads", () => {
  it("sends calls to the live threads while the project is shared and to the file store otherwise", async () => {
    const { file, live, routed, setActive } = setup();
    expect(await routed.threads("p")).toEqual([{ id: "file" }]);
    setActive(true);
    expect(await routed.threads("p")).toEqual([{ id: "live" }]);
    await routed.reply("t", "hi");
    await routed.resolve("t");
    await routed.addComment("p", "main.tex", { start: 0, end: 1 }, "x");
    expect(live.store.reply).toHaveBeenCalledWith("t", "hi");
    expect(live.store.resolve).toHaveBeenCalledWith("t");
    expect(live.store.addComment).toHaveBeenCalled();
    expect(file.store.reply).not.toHaveBeenCalled();
    setActive(false);
    await routed.resolve("t");
    expect(file.store.resolve).toHaveBeenCalledWith("t");
  });

  it("re-subscribes the anchors when the share opens and closes", () => {
    const { routed, setActive } = setup();
    const seen: TextRange[][] = [];
    const stop = routed.commentAnchorsFor("p", "main.tex").subscribe((ranges) => seen.push(ranges));
    setActive(true);
    setActive(false);
    expect(seen.map((r) => r[0]!.start)).toEqual([0, 5, 0]);
    stop();
    setActive(true);
    expect(seen).toHaveLength(3);
  });

  it("reports changes of the live threads once the share is active, and of the file store always", () => {
    const { file, live, routed, setActive } = setup();
    const changed = jest.fn();
    const stop = routed.onDidChange(changed);
    file.listeners.forEach((l) => l());
    expect(changed).toHaveBeenCalledTimes(1);
    setActive(true);
    expect(changed).toHaveBeenCalledTimes(2);
    live.listeners.forEach((l) => l());
    expect(changed).toHaveBeenCalledTimes(3);
    stop();
    expect(live.listeners.size).toBe(0);
    expect(file.listeners.size).toBe(0);
  });
});
