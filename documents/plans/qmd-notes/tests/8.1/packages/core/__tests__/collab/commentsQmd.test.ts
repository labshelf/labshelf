/**
 * Verifies that comment threads map to the items of .labshelf/comments.qmd and back: replies, the resolved flag, thread and reply order.
 * Verifies that loadCommentsDocument and updateCommentsDocument work on that file only: unknown attributes and loose text survive, an unreadable file is never overwritten.
 */
import {
  COMMENTS_PATH,
  deriveCommentThreads,
  addThreadReply,
  setThreadResolved,
  loadCommentsDocument,
  updateCommentsDocument,
  type CommentThread,
  type CommentsFileAccess,
} from "../../src/collab/index";
import * as collab from "../../src/collab/index";
import { parseCommentsQmd, serializeCommentsQmd, threadsToItems } from "../../src/collab/commentsQmd";

const comment = (id: string, author: string, body: string, createdAt: string): CommentThread["comments"][number] => ({ id, author, body, createdAt });

const thread = (id: string, overrides: Partial<CommentThread> = {}): CommentThread => ({
  id,
  file: "chapters/intro.tex",
  anchor: { quote: "a strong baseline", prefix: "we use ", suffix: " on" },
  comments: [comment(`${id}-c1`, "Ana", "Which one?", "2026-10-16T09:12:00.000Z")],
  resolved: false,
  ...overrides,
});

function threadsOf(text: string): CommentThread[] {
  const doc = parseCommentsQmd(text);
  expect(doc).toBeDefined();
  return deriveCommentThreads(doc!);
}

function roundTrip(threads: CommentThread[]): CommentThread[] {
  return threadsOf(serializeCommentsQmd({ threads }));
}

function access(initial: string | undefined): CommentsFileAccess & { text: string | undefined; writes: number } {
  const state = {
    text: initial, writes: 0,
    read: async () => state.text,
    write: async (next: string) => { state.text = next; state.writes += 1; },
  };
  return state;
}

function anchorAttr(a: { quote: string; prefix: string; suffix: string }): string {
  return `quote:${Buffer.from(JSON.stringify(a), "utf8").toString("base64url")}`;
}

function firstItem(t: CommentThread, extra = ""): string {
  const c = t.comments[0]!;
  return `::: {#${t.id} .labshelf-item anchor="${anchorAttr(t.anchor)}" file="${t.file}" author="${c.author}" created="${c.createdAt}"${extra}}\n${c.body}\n:::\n`;
}

function replyItem(threadId: string, c: CommentThread["comments"][number]): string {
  return `::: {#${c.id} .labshelf-item thread="${threadId}" author="${c.author}" created="${c.createdAt}"}\n${c.body}\n:::\n`;
}

describe("8.1 comments.qmd mapping", () => {
  it("8.1a threads written to the file and read back are equal, replies included", () => {
    const threads = [
      thread("t1", {
        comments: [
          comment("t1-c1", "Ana", "Which one?", "2026-10-16T09:12:00.000Z"),
          comment("t1-c2", "Bo", "The second baseline,\nsee \"Table 2\".", "2026-10-16T10:00:00.000Z"),
          comment("t1-c3", "Ana", "Thanks.", "2026-10-17T08:30:00.000Z"),
        ],
      }),
      thread("t2", { file: "main.typ", anchor: { quote: "naïve → 日本語 \"q\"", prefix: "", suffix: "" }, resolved: true }),
    ];
    expect(roundTrip(threads)).toEqual(threads);
  });

  it("8.1a shared-project anchors keep their start and end relative positions", () => {
    const live = thread("t1", { anchor: { quote: "baseline", prefix: "a ", suffix: " on", start: "AQIDBA==", end: "BQYHCA==" } });
    expect(roundTrip([live])).toEqual([live]);
  });

  it("8.1a threadsToItems yields one item per comment", () => {
    const threads = [
      thread("t1", { comments: [comment("t1-c1", "Ana", "One", "2026-10-16T09:12:00.000Z"), comment("t1-c2", "Bo", "Two", "2026-10-16T09:13:00.000Z")] }),
      thread("t2"),
    ];
    expect(threadsToItems(threads)).toHaveLength(3);
    expect(threadsToItems([])).toHaveLength(0);
  });

  it("8.1a the written file keeps existing ids verbatim as item ids and marks replies with thread=", () => {
    const t = thread("t1", { comments: [comment("t1-c1", "Ana", "One", "2026-10-16T09:12:00.000Z"), comment("t1-c2", "Bo", "Two", "2026-10-16T09:13:00.000Z")] });
    const text = serializeCommentsQmd({ threads: [t] });
    expect(text).toContain("#t1 ");
    expect(text).toContain("#t1-c1 ".replace("t1-c1", "t1-c2"));
    expect(text).toContain('thread="t1"');
    expect(text.match(/thread="/g)).toHaveLength(1);
    expect(text.match(/file="chapters\/intro\.tex"/g)).toHaveLength(1);
  });

  it("8.1a threads survive updateCommentsDocument and loadCommentsDocument through a file access", async () => {
    const file = access(undefined);
    const t = thread("t1");
    await updateCommentsDocument(file, (doc) => ({ ...doc, threads: [...doc.threads, t] }));
    const reply = comment("t1-c2", "Bo", "Ours", "2026-10-17T10:00:00.000Z");
    await updateCommentsDocument(file, (doc) => addThreadReply(doc, "t1", reply));
    const loaded = await loadCommentsDocument(file);
    expect(loaded).toBeDefined();
    expect(deriveCommentThreads(loaded!)).toEqual([{ ...t, comments: [...t.comments, reply] }]);
  });

  it("8.1b the resolved flag is written only for a resolved thread", () => {
    const open = serializeCommentsQmd({ threads: [thread("t1")] });
    expect(open).not.toContain("resolved");
    const t = thread("t1", {
      resolved: true,
      comments: [comment("t1-c1", "Ana", "One", "2026-10-16T09:12:00.000Z"), comment("t1-c2", "Bo", "Two", "2026-10-16T09:13:00.000Z")],
    });
    const closed = serializeCommentsQmd({ threads: [t] });
    expect(closed).toContain('resolved="true"');
    expect(closed.match(/resolved=/g)).toHaveLength(1);
  });

  it("8.1b the resolved flag is read back, and a thread without it reads as open", () => {
    const [read] = roundTrip([thread("t1", { resolved: true })]);
    expect(read!.resolved).toBe(true);
    const [open] = roundTrip([thread("t1")]);
    expect(open!.resolved).toBe(false);
  });

  it("8.1b resolving and reopening through the store writes and drops the flag", async () => {
    const file = access(undefined);
    await updateCommentsDocument(file, (doc) => ({ ...doc, threads: [thread("t1")] }));
    await updateCommentsDocument(file, (doc) => setThreadResolved(doc, "t1", true));
    expect(file.text).toContain('resolved="true"');
    expect(deriveCommentThreads((await loadCommentsDocument(file))!)[0]!.resolved).toBe(true);
    await updateCommentsDocument(file, (doc) => setThreadResolved(doc, "t1", false));
    expect(file.text).not.toContain("resolved");
    expect(deriveCommentThreads((await loadCommentsDocument(file))!)[0]!.resolved).toBe(false);
  });

  it("8.1c threads keep the order they are written in, not creation time or id order", () => {
    const later = thread("a-later", { comments: [comment("x1", "Ana", "later", "2026-10-20T09:00:00.000Z")] });
    const earlier = thread("z-earlier", { comments: [comment("x2", "Ana", "earlier", "2026-10-10T09:00:00.000Z")] });
    expect(roundTrip([later, earlier]).map((each) => each.id)).toEqual(["a-later", "z-earlier"]);
    expect(roundTrip([earlier, later]).map((each) => each.id)).toEqual(["z-earlier", "a-later"]);
  });

  it("8.1c replies keep the order they are written in, not creation time", () => {
    const t = thread("t1", {
      comments: [
        comment("c1", "Ana", "first", "2026-10-16T09:00:00.000Z"),
        comment("c3", "Bo", "second, but dated later", "2026-10-18T09:00:00.000Z"),
        comment("c2", "Cy", "third, but dated earlier", "2026-10-17T09:00:00.000Z"),
      ],
    });
    expect(roundTrip([t])[0]!.comments.map((each) => each.id)).toEqual(["c1", "c3", "c2"]);
  });

  it("8.1c a file with interleaved items reads threads by first item and replies by file order", () => {
    const t1 = thread("t1");
    const t2 = thread("t2");
    const text = [
      firstItem(t1),
      firstItem(t2),
      replyItem("t1", comment("r1", "Bo", "to t1", "2026-10-17T09:00:00.000Z")),
      replyItem("t2", comment("r2", "Bo", "to t2", "2026-10-17T09:05:00.000Z")),
      replyItem("t1", comment("r3", "Cy", "to t1 again", "2026-10-16T12:00:00.000Z")),
    ].join("\n");
    const threads = threadsOf(text);
    expect(threads.map((each) => each.id)).toEqual(["t1", "t2"]);
    expect(threads[0]!.comments.map((each) => each.id)).toEqual(["t1-c1", "r1", "r3"]);
    expect(threads[1]!.comments.map((each) => each.id)).toEqual(["t2-c1", "r2"]);
  });

  it("8.1c a hand-written first item carries author, date, body and anchor of the comment", () => {
    const t = thread("t1", { resolved: true });
    const text = firstItem(t, ' resolved="true"');
    expect(threadsOf(text)).toEqual([t]);
  });

  it("8.1d unknown attributes and text outside items survive a load and update round trip", async () => {
    const t1 = thread("t1");
    const t2 = thread("t2");
    const written = serializeCommentsQmd({ threads: [t1, t2] });
    const withUnknown = written
      .replace(/^(::: \{#t1 .*)\}$/m, '$1 colour="red"}')
      .replace(/^(::: \{#t2 .*)\}$/m, '$1 .pinned reviewer="Dana"}');
    expect(withUnknown).toContain('colour="red"');
    expect(withUnknown).toContain('reviewer="Dana"');
    const text = `Notes about this project.\n\n${withUnknown}\nA stray paragraph between edits.\n`;
    const file = access(text);
    const reply = comment("t1-c2", "Bo", "Ours", "2026-10-17T10:00:00.000Z");
    await updateCommentsDocument(file, (doc) => addThreadReply(doc, "t1", reply));
    expect(file.text).toContain("Notes about this project.");
    expect(file.text).toContain("A stray paragraph between edits.");
    expect(file.text).toContain('colour="red"');
    expect(file.text).toContain('reviewer="Dana"');
    expect(file.text).toContain(".pinned");
    expect(file.text!.indexOf("Notes about this project.")).toBeLessThan(file.text!.indexOf("#t1 "));
    const threads = deriveCommentThreads((await loadCommentsDocument(file))!);
    expect(threads.map((each) => each.id)).toEqual(["t1", "t2"]);
    expect(threads[0]!.comments.map((each) => each.id)).toEqual(["t1-c1", "t1-c2"]);
  });

  it("8.1d a file with unknown attributes and loose text parsed and serialized again is unchanged", () => {
    const written = serializeCommentsQmd({ threads: [thread("t1")] });
    const text = `Intro.\n\n${written.replace(/^(::: \{#t1 .*)\}$/m, '$1 colour="red"}')}\nOutro.\n`;
    const doc = parseCommentsQmd(text);
    expect(doc).toBeDefined();
    expect(serializeCommentsQmd(doc!)).toBe(text);
  });

  it("8.1e a file with git conflict markers is read as unreadable and is not overwritten", async () => {
    const t1 = serializeCommentsQmd({ threads: [thread("t1")] });
    const t2 = serializeCommentsQmd({ threads: [thread("t2")] });
    const conflicted = `<<<<<<< ours\n${t1}=======\n${t2}>>>>>>> theirs\n`;
    expect(parseCommentsQmd(conflicted)).toBeUndefined();
    const file = access(conflicted);
    expect(await loadCommentsDocument(file)).toBeUndefined();
    await expect(updateCommentsDocument(file, (doc) => addThreadReply(doc, "t1", comment("r", "Bo", "x", "2026-10-17T10:00:00.000Z")))).rejects.toThrow();
    expect(file.writes).toBe(0);
    expect(file.text).toBe(conflicted);
  });

  it("8.1e a file that cannot be read is never overwritten", async () => {
    const state = { writes: 0, read: async (): Promise<string | undefined> => { throw new Error("EACCES"); }, write: async (): Promise<void> => { state.writes += 1; } };
    await expect(updateCommentsDocument(state, (doc) => ({ ...doc, threads: [thread("t1")] }))).rejects.toThrow();
    expect(state.writes).toBe(0);
  });

  it("8.1e a missing file is created on the first edit", async () => {
    const file = access(undefined);
    expect(deriveCommentThreads((await loadCommentsDocument(file))!)).toEqual([]);
    await updateCommentsDocument(file, (doc) => ({ ...doc, threads: [thread("t1")] }));
    expect(file.writes).toBe(1);
    expect(deriveCommentThreads((await loadCommentsDocument(file))!)).toEqual([thread("t1")]);
  });

  it("A7 the comments store lives at .labshelf/comments.qmd", () => {
    expect(COMMENTS_PATH).toBe(".labshelf/comments.qmd");
  });

  it("A7 the JSON parse helpers are gone from the collab exports", () => {
    expect((collab as Record<string, unknown>)["parseCommentsFile"]).toBeUndefined();
    expect((collab as Record<string, unknown>)["serializeCommentsFile"]).toBeUndefined();
  });

  it("A7 a comments.json text in the store is not read as threads", async () => {
    const json = JSON.stringify({ threads: [thread("t1")] }, null, 2);
    const doc = await loadCommentsDocument(access(json));
    expect(doc === undefined ? [] : deriveCommentThreads(doc)).toEqual([]);
  });
});
