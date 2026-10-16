// Tests for `labshelf open`: ids, cite keys and labshelf: links, and how the page reaches the viewer.
import * as childProcess from "node:child_process";

import { UsageError } from "../../src/cli";
import { CliSessionHarness } from "../fixtures/cliSession";
import type { PaperFixture } from "../fixtures/library";

jest.mock("node:child_process", () => ({
  ...jest.requireActual<typeof childProcess>("node:child_process"),
  spawn: jest.fn(() => ({ on: jest.fn(), unref: jest.fn() })),
}));

const spawn = jest.mocked(childProcess.spawn);

const PAPERS: PaperFixture[] = [
  { id: "b-attention", title: "Second", pdf: true, meta: { citekey: "vaswani2017" } },
  { id: "a-attention", title: "First", pdf: true, meta: { citekey: "vaswani2017" } },
  { id: "other", title: "Other", pdf: true, meta: { citekey: "other2020" } },
  {
    id: "resumed", title: "Resumed", pdf: true, meta: { citekey: "resumed2021" },
    sidecar: { annotations: [], reading: { page: 7, scaleValue: "1", updatedAt: "2025-01-01T00:00:00.000Z" } },
  },
  { id: "nopdf", title: "No PDF", meta: { citekey: "nopdf2020" } },
];

let harness: CliSessionHarness;

beforeEach(async () => {
  spawn.mockClear();
  harness = new CliSessionHarness();
  await harness.setup();
});

afterEach(async () => {
  await harness.teardown();
});

function spawned(): { command: string; args: string[] } {
  expect(spawn).toHaveBeenCalledTimes(1);
  const [command, args] = spawn.mock.calls[0]!;
  return { command, args: [...(args ?? [])] };
}

describe("open with a labshelf: link", () => {
  it("substitutes the page into a {page} viewer, the smallest id winning a shared cite key", async () => {
    const s = await harness.session(PAPERS, { config: { version: 1, terminal: { pdfViewer: "zathura -P {page}" } } });
    expect(await s.run("open", "labshelf:vaswani2017#p5")).toBe(0);
    const { command, args } = spawned();
    expect(command).toBe("zathura");
    expect(args.slice(0, 2)).toEqual(["-P", "5"]);
    expect(args[2]).toContain("a-attention");
    expect(s.text()).toBe("");
  });

  it("opens at the saved reading position, else page 1, when the link has no page", async () => {
    const s = await harness.session(PAPERS, { config: { version: 1, terminal: { pdfViewer: "okular -p {page}" } } });
    await s.run("open", "labshelf:resumed2021");
    await s.run("open", "labshelf:other2020");
    expect(spawn.mock.calls.map((call) => call[1]?.[1])).toEqual(["7", "1"]);
  });

  it("prints the page for a viewer without {page} and does not pass it on", async () => {
    const s = await harness.session(PAPERS, { config: { version: 1, terminal: { pdfViewer: "mupdf" } } });
    expect(await s.run("open", "labshelf:other2020#p5")).toBe(0);
    expect(s.text()).toBe("Opened other2020 — go to page 5");
    const { command, args } = spawned();
    expect(command).toBe("mupdf");
    expect(args).toHaveLength(1);
    expect(args[0]).toMatch(/paper\.pdf$/);
  });

  it("prints the page and gives the system opener only the file", async () => {
    const s = await harness.session(PAPERS);
    await s.run("open", "labshelf:other2020#p5");
    expect(s.text()).toBe("Opened other2020 — go to page 5");
    expect(spawned().args).toHaveLength(1);
  });

  it("prints no page line for a link without a page", async () => {
    const s = await harness.session(PAPERS);
    await s.run("open", "labshelf:other2020");
    expect(s.text()).toBe("");
  });

  it("accepts the web+labshelf: and percent-encoded forms", async () => {
    const s = await harness.session(PAPERS, { config: { version: 1, terminal: { pdfViewer: "evince -i {page}" } } });
    await s.run("open", "web+labshelf:other2020#p3");
    await s.run("open", "web%2Blabshelf%3Aother2020%23p4");
    expect(spawn.mock.calls.map((call) => call[1]?.[1])).toEqual(["3", "4"]);
  });

  it("fails with a usage error naming an unknown key", async () => {
    const s = await harness.session(PAPERS);
    await expect(s.run("open", "labshelf:ghost2020#p2")).rejects.toThrow(new UsageError('No paper with cite key "ghost2020"'));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("exits 1 for a paper without a PDF", async () => {
    const s = await harness.session(PAPERS);
    expect(await s.run("open", "labshelf:nopdf2020#p2")).toBe(1);
    expect(s.errText()).toContain("No PDF on this device for nopdf");
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("open with an id or a cite key", () => {
  it("opens by id and by cite key without printing a page line", async () => {
    const s = await harness.session(PAPERS);
    expect(await s.run("open", "other")).toBe(0);
    expect(await s.run("open", "other2020")).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(s.text()).toBe("");
  });
});
