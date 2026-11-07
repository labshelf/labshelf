/** Verifies the space.json `seen` entries: read and written back, stamped once per person and conversation, accepted from the page, and the unread counts list() derives from them. */
import { parseSpaceFile } from "../../src/spaces/parseSpaceFile";
import { serializeSpaceFile, type Space } from "../../src/spaces/space";
import { seenEntryId, withSeen } from "../../src/spaces/spaceMutations";
import { parseSpacesMessage } from "../../src/spaces/spacesProtocol";
import { countUnread, SPACE_CHAT_PATH } from "../../src/spaces/spaceDiscussionsStore";
import { MATH_PLACEHOLDER, plainText } from "../../src/spaces/discussionText";
import { seededFixture, NOW } from "./store/spaceStoreFixture";

const base = { version: 1, name: "Thesis", folders: [], papers: [], projects: [], dates: [] };
const PATH = "discussions/loss.qmd";

function ready(doc: unknown): Space {
  const read = parseSpaceFile(JSON.stringify(doc), { id: "alpha", path: "space.json" });
  if (read.state !== "ready") throw new Error("unreadable");
  return read.space;
}

describe("space.json seen", () => {
  it("reads valid entries, keeps unknown keys and invalid entries, and writes them back", () => {
    const entry = { id: seenEntryId("Ana", PATH), path: PATH, by: "Ana", at: NOW, color: "red" };
    const space = ready({ ...base, seen: [entry, { id: "x", path: 3 }] });
    expect(space.seen).toEqual([{ id: entry.id, path: PATH, by: "Ana", at: NOW, extra: { color: "red" } }]);
    expect(JSON.parse(serializeSpaceFile(space)).seen).toEqual([entry, { id: "x", path: 3 }]);
  });

  it("writes no seen key for a Space without one", () => {
    expect(JSON.parse(serializeSpaceFile(ready(base)))).not.toHaveProperty("seen");
  });

  it("makes the Space read-only when seen is not a list", () => {
    const read = parseSpaceFile(JSON.stringify({ ...base, seen: {} }), { id: "alpha", path: "space.json" });
    expect(read.state === "ready" && read.readOnlyReason).toMatch(/seen/);
  });
});

describe("withSeen", () => {
  it("keeps one entry per person and conversation, the later at winning", () => {
    let space = withSeen(ready(base), PATH, "Ana", "2026-11-01T10:00:00Z");
    space = withSeen(space, PATH, "Ana", "2026-11-02T10:00:00Z");
    space = withSeen(space, PATH, "Ana", "2026-10-30T10:00:00Z");
    space = withSeen(space, PATH, "Bo", "2026-11-01T10:00:00Z");
    expect(space.seen?.map(({ id, by, at }) => ({ id, by, at }))).toEqual([
      { id: seenEntryId("Ana", PATH), by: "Ana", at: "2026-11-02T10:00:00Z" },
      { id: seenEntryId("Bo", PATH), by: "Bo", at: "2026-11-01T10:00:00Z" },
    ]);
  });

  it("derives the same id on every copy and a different one per person or path", () => {
    expect(seenEntryId("Ana", PATH)).toBe(seenEntryId("Ana", PATH));
    expect(new Set([seenEntryId("Ana", PATH), seenEntryId("Bo", PATH), seenEntryId("Ana", SPACE_CHAT_PATH), seenEntryId("Ana:x", PATH)]).size).toBe(4);
  });

  it("the store stamps by and now through markSeen", async () => {
    const f = await seededFixture({ alpha: base });
    await f.store.markSeen("alpha", PATH, "Ana");
    await f.store.markSeen("alpha", PATH, "Ana");
    expect((await f.json("alpha"))["seen"]).toEqual([{ id: seenEntryId("Ana", PATH), path: PATH, by: "Ana", at: NOW }]);
  });
});

describe("parseSpacesMessage markSeen", () => {
  it("accepts a discussion path and rejects other paths", () => {
    expect(parseSpacesMessage({ type: "markSeen", id: "alpha", path: PATH })).toEqual({ type: "markSeen", id: "alpha", path: PATH });
    expect(parseSpacesMessage({ type: "markSeen", id: "alpha", path: SPACE_CHAT_PATH })).toEqual({ type: "markSeen", id: "alpha", path: SPACE_CHAT_PATH });
    for (const path of ["notes/a.qmd", "../x.qmd", "discussions/../x.qmd", 3, undefined]) {
      expect(parseSpacesMessage({ type: "markSeen", id: "alpha", path })).toBeUndefined();
    }
  });
});

describe("unread", () => {
  const messages = [
    { author: "Bo", created: "2026-11-01T10:00:00Z" }, { author: "Ana", created: "2026-11-02T10:00:00Z" }, { author: "Bo", created: "2026-11-03T10:00:00Z" },
  ];

  it("counts the messages by others after the reader's seen at, and every message by others without one", () => {
    expect(countUnread(messages, PATH, { author: "Ana", seen: [] })).toBe(2);
    expect(countUnread(messages, PATH, { author: "Ana", seen: [{ path: PATH, by: "Ana", at: "2026-11-02T00:00:00Z" }] })).toBe(1);
    expect(countUnread(messages, PATH, { author: "Ana", seen: [{ path: PATH, by: "Bo", at: "2026-11-04T00:00:00Z" }] })).toBe(2);
    expect(countUnread(messages, PATH, { author: "Ana", seen: [{ path: PATH, by: "Ana", at: "2026-11-04T00:00:00Z" }] })).toBe(0);
  });

  it("list() carries unread for the reader, the topic item not counted", async () => {
    const f = await seededFixture({ alpha: base });
    const path = await f.store.discussions.create("alpha", "Loss", "Which one?", "Bo");
    await f.store.discussions.addMessage("alpha", path, "Huber.", "Bo");
    await f.store.discussions.addMessage("alpha", path, "Agreed.", "Ana");
    expect((await f.store.discussions.list("alpha"))[0]).not.toHaveProperty("unread");
    expect((await f.store.discussions.list("alpha", { author: "Ana", seen: [] }))[0]?.unread).toBe(1);
    expect((await f.store.discussions.list("alpha", { author: "Ana", seen: [{ path, by: "Ana", at: NOW }] }))[0]?.unread).toBe(0);
  });
});

describe("previews without TeX", () => {
  it("shows inline and display math as the placeholder", () => {
    expect(plainText("If $\\delta{2s} < \\sqrt{2}$ then\n$$x^2$$ holds, costs \\$5")).toBe(`If ${MATH_PLACEHOLDER} then ${MATH_PLACEHOLDER} holds, costs $5`);
    expect(plainText("Keep $a$ here", true)).toBe("Keep $a$ here");
  });

  it("search excerpts show math as the placeholder", async () => {
    const f = await seededFixture({ alpha: base });
    const path = await f.store.discussions.create("alpha", "Bound", "", "Bo");
    await f.store.discussions.addMessage("alpha", path, "The bound $\\delta{2s} < \\sqrt{2}$ is tight.", "Bo");
    const hits = await f.store.discussions.search("alpha", "tight");
    expect(hits[0]?.excerpt).toBe(`The bound ${MATH_PLACEHOLDER} is tight.`);
  });
});
