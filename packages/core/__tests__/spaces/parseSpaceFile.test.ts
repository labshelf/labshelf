/** Verifies the saved messages, agreements, tasks and meetings kept in space.json: store edits, reading, writing back and the .ics export. */
import { parseSpaceFile } from "../../src/spaces/parseSpaceFile";
import { serializeSpaceFile } from "../../src/spaces/space";
import { buildIcs } from "../../src/spaces/spaceOverview";
import { seededFixture } from "./store/spaceStoreFixture";

const space = { version: 1, name: "Thesis", folders: [], papers: [], projects: [], dates: [] };
const ref = { path: "discussions/loss.qmd", itemId: "m1" };

async function read(f: Awaited<ReturnType<typeof seededFixture>>) {
  const result = await f.store.read("alpha");
  if (result.state !== "ready") throw new Error(result.reason);
  return result.space;
}

describe("saved messages and agreements in space.json", () => {
  it("toggles a save per person and records, edits and removes agreements stamped with who and when", async () => {
    const f = await seededFixture({ alpha: space });
    await f.store.toggleSaved("alpha", ref, "Ana");
    await f.store.toggleSaved("alpha", ref, "Bo");
    await f.store.toggleSaved("alpha", ref, "Ana");
    expect((await read(f)).saved?.map((entry) => entry.by)).toEqual(["Bo"]);
    const id = await f.store.addAgreement("alpha", { ...ref, text: " Use Huber " }, "Ana");
    await f.store.updateAgreement("alpha", id, "Use Huber, delta 1");
    const [agreement] = (await read(f)).agreements ?? [];
    expect(agreement).toMatchObject({ id, text: "Use Huber, delta 1", ...ref, by: "Ana" });
    expect(agreement!.created).toMatch(/^2026-/);
    await f.store.removeAgreement("alpha", id);
    expect((await read(f)).agreements).toEqual([]);
  });

  it("reads and writes back saved, agreements, task and meeting fields, keeping unknown keys and invalid entries", () => {
    const text = JSON.stringify({
      ...space,
      dates: [
        { id: "t1", kind: "task", title: "Run", date: "2026-11-05", done: false, assignee: "Bo", source: ref },
        { id: "m1", kind: "meeting", title: "Sync", date: "2026-11-06", start: "14:00", end: "15:00", participants: ["Ana", "Bo"], agenda: "Loss", source: ref, room: "A" },
      ],
      saved: [{ id: "s1", ...ref, by: "Ana", created: "2026-11-04T10:00:00Z" }, { id: "s2" }],
      agreements: [{ id: "a1", text: "Huber", ...ref, by: "Ana", created: "2026-11-04T10:00:00Z", note: 1 }],
    });
    const result = parseSpaceFile(text, { id: "alpha", path: "space.json" });
    if (result.state !== "ready") throw new Error(result.reason);
    expect(result.readOnlyReason).toBeUndefined();
    expect(result.space.dates[1]).toMatchObject({ kind: "meeting", start: "14:00", participants: ["Ana", "Bo"], source: ref, extra: { room: "A" } });
    expect(result.space.saved).toHaveLength(1);
    const out = JSON.parse(serializeSpaceFile(result.space));
    expect(out.dates).toEqual(JSON.parse(text).dates);
    expect(out.saved).toEqual(JSON.parse(text).saved);
    expect(out.agreements).toEqual(JSON.parse(text).agreements);
  });

  it("leaves a file without the new lists unchanged and rejects a meeting time that is not HH:MM", () => {
    const result = parseSpaceFile(JSON.stringify({ ...space, dates: [{ id: "m", kind: "meeting", title: "x", date: "2026-11-06", start: "2pm" }] }), { id: "alpha", path: "space.json" });
    if (result.state !== "ready") throw new Error(result.reason);
    expect(result.space.dates).toEqual([]);
    const out = JSON.parse(serializeSpaceFile(result.space));
    expect("saved" in out || "agreements" in out).toBe(false);
  });

  it("exports a meeting to .ics with its times and agenda", () => {
    const result = parseSpaceFile(JSON.stringify({ ...space, dates: [{ id: "m1", kind: "meeting", title: "Sync", date: "2026-11-06", start: "14:00", end: "15:30", agenda: "Loss" }] }), { id: "alpha", path: "space.json" });
    if (result.state !== "ready") throw new Error(result.reason);
    const ics = buildIcs(result.space, [], Date.UTC(2026, 10, 4));
    expect(ics).toContain("DTSTART:20261106T140000");
    expect(ics).toContain("DTEND:20261106T153000");
    expect(ics).toContain("DESCRIPTION:Loss");
  });
});
