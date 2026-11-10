/**
 * The browser's editor preferences: one store per library, over .research/editor-prefs.json, re-read when the page gets the focus again.
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import { DEFAULT_TYPING_HELPERS } from "@labshelf/core";

import { editorPrefsOf } from "../../src/writing/editorPrefs";

const PATH = ".research/editor-prefs.json";
const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } as never;

function memoryFs(files: Map<string, string>) {
  return {
    stat: jest.fn(async (path: string) => (files.has(path) ? { isFile: true } : undefined)),
    readFile: jest.fn(async (path: string) => new TextEncoder().encode(files.get(path))),
    writeFile: jest.fn(async (path: string, bytes: Uint8Array) => { files.set(path, new TextDecoder().decode(bytes)); }),
  } as never;
}

describe("editorPrefsOf", () => {
  it("reads the defaults from a missing file and writes the switches to the library file", async () => {
    const files = new Map<string, string>();
    const store = editorPrefsOf(memoryFs(files), logger);
    expect(await store.typing()).toEqual(DEFAULT_TYPING_HELPERS);
    await store.setTyping({ ...DEFAULT_TYPING_HELPERS, quotes: false });
    expect(JSON.parse(files.get(PATH) ?? "{}").typing.quotes).toBe(false);
  });

  it("gives one store per file system", () => {
    const fs = memoryFs(new Map());
    expect(editorPrefsOf(fs, logger)).toBe(editorPrefsOf(fs, logger));
  });

  it("tells its listeners about a change another app made when the window gets the focus", async () => {
    const files = new Map<string, string>();
    const store = editorPrefsOf(memoryFs(files), logger);
    await store.typing();
    const heard: boolean[] = [];
    store.onChange((typing) => heard.push(typing.scripts));
    files.set(PATH, JSON.stringify({ version: 1, typing: { ...DEFAULT_TYPING_HELPERS, scripts: false } }));
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard).toEqual([false]);
  });
});
