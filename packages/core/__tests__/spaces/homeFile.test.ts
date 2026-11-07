/** Verifies the Home desk file: parse, write back unknown keys, pins, tasks and the limit of 8. */
import {
  EMPTY_HOME, HOME_DESK_LIMIT, parseHomeFile, parseHomeTaskInput, serializeHomeFile, withHomeNote, withHomePin, withHomeTask, withoutHomeEntry, type HomeFile,
} from "../../src/spaces/homeFile";

describe("home.json", () => {
  it("reads a missing file as an empty desk", () => {
    expect(parseHomeFile(undefined)).toEqual(EMPTY_HOME);
  });

  it("keeps unknown keys and unreadable entries on rewrite and drops repeats", () => {
    const text = JSON.stringify({ version: 1, theme: "x", desk: [{ kind: "paper", ref: "a", color: 1 }, { kind: "paper", ref: "a" }, { kind: "alien" }] });
    const home = parseHomeFile(text);
    expect(home.desk).toHaveLength(1);
    expect(JSON.parse(serializeHomeFile(home))).toEqual({ version: 1, desk: [{ kind: "paper", ref: "a", color: 1 }, { kind: "alien" }], theme: "x" });
  });

  it("reads a newer version as read-only", () => {
    expect(parseHomeFile(JSON.stringify({ version: 2, desk: [] })).readOnlyReason).toMatch(/newer/);
  });

  it("makes a repeat pin a no-op and refuses past the limit", () => {
    let home: HomeFile = EMPTY_HOME;
    for (let i = 0; i < HOME_DESK_LIMIT; i++) home = withHomePin(home, { kind: "paper", ref: `p${i}` });
    expect(withHomePin(home, { kind: "paper", ref: "p0" })).toBe(home);
    expect(() => withHomePin(home, { kind: "space", ref: "s" })).toThrow(/at most 8/);
    expect(() => withHomeTask(home, { title: "T" })).toThrow(/at most 8/);
  });

  it("adds a task and removes it when completed", () => {
    const { home, id } = withHomeTask(EMPTY_HOME, { title: "Write", date: "2026-11-05" });
    expect(home.desk).toEqual([{ kind: "task", id, title: "Write", date: "2026-11-05", extra: {} }]);
    expect(withoutHomeEntry(home, id).desk).toEqual([]);
  });

  it("parses task drafts: blank title refused, blank optionals dropped", () => {
    expect(parseHomeTaskInput({ title: "  " })).toBeUndefined();
    expect(parseHomeTaskInput({ title: " A ", description: " ", date: "" })).toEqual({ title: "A" });
    expect(parseHomeTaskInput({ title: "A", link: { kind: "nope", ref: "x" } })).toBeUndefined();
  });
});

describe("home.json reminders", () => {
  it("reads, sets, clears and writes back the note of a pin beside unknown keys", () => {
    const home = parseHomeFile(JSON.stringify({ version: 1, desk: [{ kind: "space", ref: "s", note: "  Ask Ana  ", color: 2 }, { kind: "paper", ref: "a", note: "   " }] }));
    expect(home.desk[0]).toMatchObject({ note: "Ask Ana", extra: { color: 2 } });
    expect(home.desk[1]).not.toHaveProperty("note");
    const changed = withHomeNote(home, "paper:a", "Page 7");
    expect(changed.desk[1]).toMatchObject({ note: "Page 7" });
    const cleared = withHomeNote(changed, "space:s");
    expect(cleared.desk[0]).not.toHaveProperty("note");
    expect(JSON.parse(serializeHomeFile(cleared)).desk).toEqual([{ kind: "space", ref: "s", color: 2 }, { kind: "paper", ref: "a", note: "Page 7" }]);
    expect(withHomeNote(home, "nope", "x")).toBe(home);
  });

  it("pins with a reminder", () => {
    expect(withHomePin(EMPTY_HOME, { kind: "project", ref: "p" }, " Finish §2 ").desk[0]).toMatchObject({ kind: "project", ref: "p", note: "Finish §2" });
  });
});
