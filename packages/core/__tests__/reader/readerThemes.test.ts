import {
  ReaderHostController, ReaderThemeStore, isWebviewMessage, mergeReaderThemes, normalizePaperSidecar, parseReaderThemes,
  serializePaperSidecar, serializeReaderThemes, type HostToWebview, type ReaderThemesPort,
} from "../../src/reader/index";
import type { CustomReaderTheme } from "../../src/model/index";
import { deriveReaderTheme, isLightColour } from "../../src/ui/tokens/index";
import { setupHost, sidecar } from "./hostFixture";

const NOW = "2026-10-30T00:00:00.000Z";

function memoryThemes(seed?: string): { port: ReaderThemesPort; file: () => string | null; writes: () => number } {
  let text: string | null = seed ?? null;
  let writes = 0;
  return { port: { read: async () => text, write: async (t) => { text = t; writes++; } }, file: () => text, writes: () => writes };
}

const theme = (id: string, updatedAt: string, extra: Partial<CustomReaderTheme> = {}): CustomReaderTheme =>
  ({ id, name: "Night", page: "#101820", ink: "#e0e0e0", updatedAt, ...extra });

describe("reader-themes.json", () => {
  it("round-trips, dropping invalid entries and keeping tombstones", () => {
    const text = JSON.stringify({ themes: [
      theme("c-bbbbbbbb", NOW), theme("c-aaaaaaaa", NOW, { deleted: true }),
      { id: "../x", name: "Bad", page: "#fff", ink: "#000", updatedAt: NOW },
      { id: "c-cccccccc", name: "Bad colour", page: "red", ink: "#000", updatedAt: NOW },
    ] });
    const themes = parseReaderThemes(text);
    expect(themes.map((t) => t.id)).toEqual(["c-aaaaaaaa", "c-bbbbbbbb"]);
    expect(parseReaderThemes(serializeReaderThemes(themes))).toEqual(themes);
    expect(parseReaderThemes("not json")).toEqual([]);
  });

  it("merges by id, the newer updatedAt winning, tombstones included", () => {
    const merged = mergeReaderThemes(
      [theme("c-aaaaaaaa", "2026-01-01T00:00:00.000Z"), theme("c-bbbbbbbb", "2026-03-01T00:00:00.000Z")],
      [theme("c-aaaaaaaa", "2026-02-01T00:00:00.000Z", { deleted: true }), theme("c-bbbbbbbb", "2026-02-01T00:00:00.000Z", { deleted: true })],
    );
    expect(merged.map((t) => [t.id, t.deleted === true])).toEqual([["c-aaaaaaaa", true], ["c-bbbbbbbb", false]]);
  });

  it("creates a theme with a fresh id and lowercase #rrggbb, edits and deletes it", async () => {
    const mem = memoryThemes();
    const store = new ReaderThemeStore(mem.port, { now: () => NOW, newId: () => "c-12345678" });
    const saved = await store.save({ name: " Night ", page: "#ABC", ink: "#E0E0E0" });
    expect(saved).toEqual({ id: "c-12345678", name: "Night", page: "#aabbcc", ink: "#e0e0e0", updatedAt: NOW });
    await store.save({ id: "c-12345678", name: "Night 2", page: "#000000", ink: "#ffffff" });
    expect((await store.list()).map((t) => t.name)).toEqual(["Night 2"]);
    await store.remove("c-12345678");
    expect(await store.list()).toEqual([]);
    expect(JSON.parse(mem.file()!).themes[0].deleted).toBe(true);
  });

  it("refuses an empty name, a bad colour or an unknown id without writing", async () => {
    const mem = memoryThemes();
    const store = new ReaderThemeStore(mem.port);
    expect(await store.save({ name: "  ", page: "#000000", ink: "#ffffff" })).toBeNull();
    expect(await store.save({ name: "X", page: "black", ink: "#ffffff" })).toBeNull();
    expect(await store.save({ id: "c-00000000", name: "X", page: "#000000", ink: "#ffffff" })).toBeNull();
    expect(mem.writes()).toBe(0);
  });
});

describe("data.json theme ref and view", () => {
  it("keeps the old bytes when no view or custom theme is set", () => {
    const data = normalizePaperSidecar(JSON.parse(sidecar));
    expect(serializePaperSidecar(data)).toBe(serializePaperSidecar(normalizePaperSidecar(JSON.parse(serializePaperSidecar(data)))));
    expect(serializePaperSidecar(data)).not.toContain("view");
  });

  it("writes view after reading and keeps a valid custom ref", () => {
    const data = normalizePaperSidecar({ annotations: [], theme: "custom:c-abcdefgh", view: { scroll: "wrapped", spread: "odd" }, deleted: [{ id: "x", deletedAt: NOW }] });
    expect(data.theme).toBe("custom:c-abcdefgh");
    expect(Object.keys(JSON.parse(serializePaperSidecar(data)))).toEqual(["annotations", "theme", "view", "deleted"]);
    expect(normalizePaperSidecar({ theme: "custom:../x", view: { scroll: "diagonal", spread: "odd" } })).toEqual({ annotations: [], theme: "auto" });
  });
});

describe("custom themes through the reader host", () => {
  function setup(seedThemes?: string) {
    const base = setupHost({ seed: sidecar });
    const mem = memoryThemes(seedThemes);
    const themes = new ReaderThemeStore(mem.port, { now: () => NOW, newId: () => "c-newtheme" });
    const host = new ReaderHostController({ ...base.ports, themes });
    return { ...base, host, mem };
  }
  const last = <T extends HostToWebview["type"]>(posted: HostToWebview[], type: T) =>
    posted.filter((m) => m.type === type).at(-1) as Extract<HostToWebview, { type: T }> | undefined;

  it("sends the theme list and view in init, and a missing custom ref as auto", async () => {
    const { host, posted, files } = setup(serializeReaderThemes([theme("c-aaaaaaaa", NOW)]));
    files.p1 = JSON.stringify({ ...JSON.parse(files.p1!), theme: "custom:c-gonegone", view: { scroll: "horizontal", spread: "none" } });
    await host.handle({ command: "ready-for-init" });
    const init = last(posted, "init")!;
    expect(init.customThemes.map((t) => t.id)).toEqual(["c-aaaaaaaa"]);
    expect(init.view).toEqual({ scroll: "horizontal", spread: "none" });
    expect(init.theme).toBe("auto");
    expect(init.customTheme).toBeUndefined();
  });

  it("creates a theme, selects it for the paper and tells other readers", async () => {
    const { host, posted, files, changes } = setup();
    await host.handle({ command: "ready-for-init" });
    await host.handle({ command: "saveCustomTheme", theme: { name: "Night", page: "#101820", ink: "#e0e0e0" } });
    expect(JSON.parse(files.p1!).theme).toBe("custom:c-newtheme");
    expect(last(posted, "customThemes")!.themes.map((t) => t.id)).toEqual(["c-newtheme"]);
    expect(last(posted, "applyTheme")).toMatchObject({ theme: "custom:c-newtheme", effectiveTheme: "dark", customTheme: { page: "#101820" } });
    expect(changes).toContainEqual({ kind: "customThemes", themes: expect.any(Array) });
  });

  it("deleting the paper's theme applies auto and keeps the ref in data.json", async () => {
    const { host, posted, files } = setup(serializeReaderThemes([theme("c-aaaaaaaa", NOW)]));
    await host.handle({ command: "ready-for-init" });
    await host.handle({ command: "selectTheme", theme: "custom:c-aaaaaaaa" });
    await host.handle({ command: "deleteCustomTheme", id: "c-aaaaaaaa" });
    expect(last(posted, "applyTheme")).toEqual({ type: "applyTheme", theme: "auto", effectiveTheme: "dark" });
    expect(JSON.parse(files.p1!).theme).toBe("custom:c-aaaaaaaa");
  });

  it("ignores a custom ref that does not exist", async () => {
    const { host, posted } = setup();
    await host.handle({ command: "ready-for-init" });
    await host.handle({ command: "selectTheme", theme: "custom:c-aaaaaaaa" });
    expect(last(posted, "applyTheme")).toBeUndefined();
  });

  it("stores a valid view mode and drops an invalid one", async () => {
    const { host, files } = setup();
    await host.handle({ command: "setViewMode", scroll: "wrapped", spread: "even" });
    expect(JSON.parse(files.p1!).view).toEqual({ scroll: "wrapped", spread: "even" });
    await host.handle({ command: "setViewMode", scroll: "diagonal", spread: "even" });
    expect(JSON.parse(files.p1!).view).toEqual({ scroll: "wrapped", spread: "even" });
  });

  it("re-applies the paper's custom theme when another reader edits it", async () => {
    const { host, posted } = setup(serializeReaderThemes([theme("c-aaaaaaaa", NOW)]));
    await host.handle({ command: "ready-for-init" });
    await host.handle({ command: "selectTheme", theme: "custom:c-aaaaaaaa" });
    host.onCustomThemesChange([theme("c-aaaaaaaa", NOW, { page: "#fafafa", ink: "#111111" })]);
    expect(last(posted, "applyTheme")).toMatchObject({ effectiveTheme: "light", customTheme: { page: "#fafafa" } });
  });
});

describe("protocol and derived chrome", () => {
  it("validates the new commands", () => {
    expect(isWebviewMessage({ command: "saveCustomTheme", theme: { name: "N", page: "#000000", ink: "#ffffff" } })).toBe(true);
    expect(isWebviewMessage({ command: "saveCustomTheme", theme: { name: "N", page: "#000000" } })).toBe(false);
    expect(isWebviewMessage({ command: "deleteCustomTheme", id: "" })).toBe(false);
    expect(isWebviewMessage({ command: "setViewMode", scroll: "vertical" })).toBe(false);
  });

  it("derives chrome from page and ink and picks light or dark by the page", () => {
    expect(isLightColour("#f5f0e6")).toBe(true);
    expect(isLightColour("#101820")).toBe(false);
    const derived = deriveReaderTheme("#101820", "#e0e0e0");
    expect(derived.page).toBe("#101820");
    expect(derived.fg).toMatch(/^#[0-9a-f]{6}$/);
  });
});
