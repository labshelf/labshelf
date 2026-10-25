// Tests for `labshelf cite`: the picker on a fake tty, the citation on stdout alone and the project's labshelf.bib.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import { UsageError, type Output } from "../../../src/cli";
import { runCite, type CiteTty } from "../../../src/cli/citation";
import { cleanupTempDirs, makeTempDir } from "../../fixtures/library";
import { harness } from "../../fixtures/paperService";

afterEach(cleanupTempDirs);

const ENTER = "\r";
const CTRL_C = "\x03";

function fakeTty(keys: string): CiteTty & { drawn: () => string } {
  const input = Object.assign(new PassThrough(), { setRawMode: jest.fn() });
  const output = Object.assign(new PassThrough(), { columns: 80, rows: 24 });
  const chunks: string[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  input.write(keys);
  return { input, output, close: jest.fn(), drawn: () => chunks.join("") } as unknown as CiteTty & { drawn: () => string };
}

async function setup(project?: { yaml: string; main?: string }) {
  const h = await harness([
    { id: "attention", title: "Attention Is All You Need", meta: { citekey: "vaswani2017", authors: ["Ashish Vaswani"], year: 2017 } },
    { id: "bert", title: "BERT Pre-training of Deep Bidirectional Transformers", meta: { citekey: "devlin2019", authors: ["Jacob Devlin"], year: 2019 } },
  ]);
  const dir = await makeTempDir("labshelf-cite-");
  if (project) {
    await fs.writeFile(path.join(dir, "labshelf.yaml"), project.yaml);
    if (project.main) { await fs.writeFile(path.join(dir, "main.tex"), project.main); }
  }
  const out: string[] = [];
  const err: string[] = [];
  const io: Output = { out: (t) => out.push(t), err: (t) => err.push(t), columns: 100 };
  const ctx = { store: h.store, logger: { log: async () => undefined, error: async () => undefined } };
  const run = (keys: string, flags: Record<string, string | boolean> = {}, positionals: string[] = [dir]) => {
    const tty = fakeTty(keys);
    return runCite(ctx, positionals, flags, io, tty).then((code) => ({ code, tty }));
  };
  return { dir, out, err, run };
}

const LATEX = "id: thesis\nformat: latex\n";

describe("labshelf cite", () => {
  it("prints \\cite{key} for the paper picked by fuzzy query", async () => {
    const s = await setup({ yaml: LATEX });
    const { code, tty } = await s.run(`attn${ENTER}`, { format: "latex" });
    expect(code).toBe(0);
    expect(s.out).toEqual(["\\cite{vaswani2017}"]);
    expect(tty.drawn()).toContain("Attention Is All You Need");
    expect(tty.close).toHaveBeenCalled();
  });

  it("moves the selection with the arrow keys", async () => {
    const s = await setup({ yaml: LATEX });
    const { code } = await s.run(`\x1b[B${ENTER}`, { format: "key" });
    expect(code).toBe(0);
    expect(s.out).toHaveLength(1);
    const first = await setup({ yaml: LATEX });
    await first.run(ENTER, { format: "key" });
    expect(first.out[0]).not.toBe(s.out[0]);
  });

  it("prints the bare key and the Typst reference per --format", async () => {
    const s = await setup({ yaml: LATEX });
    await s.run(`bert${ENTER}`, { format: "key" });
    await s.run(`bert${ENTER}`, { format: "typst" });
    expect(s.out).toEqual(["devlin2019", "@devlin2019"]);
  });

  it("defaults to the project's format and to LaTeX outside a project", async () => {
    const typst = await setup({ yaml: "id: paper\nformat: typst\n" });
    await typst.run(`bert${ENTER}`);
    expect(typst.out).toEqual(["@devlin2019"]);
    const none = await setup();
    await none.run(`bert${ENTER}`);
    expect(none.out).toEqual(["\\cite{devlin2019}"]);
    expect(none.err.join("\n")).toContain("labshelf.bib");
  });

  it("writes the picked paper into labshelf.bib next to the keys the sources already cite", async () => {
    const s = await setup({ yaml: LATEX, main: "\\documentclass{article}\n\\begin{document}\\cite{vaswani2017}\\end{document}\n" });
    await s.run(`bert${ENTER}`, { format: "latex" });
    const bib = await fs.readFile(path.join(s.dir, "labshelf.bib"), "utf8");
    expect(bib).toContain("devlin2019");
    expect(bib).toContain("vaswani2017");
  });

  it("exits 1 with empty stdout when the picker is cancelled", async () => {
    const s = await setup({ yaml: LATEX });
    const { code, tty } = await s.run(`att${CTRL_C}`, { format: "latex" });
    expect(code).toBe(1);
    expect(s.out).toEqual([]);
    expect(tty.close).toHaveBeenCalled();
    await expect(fs.stat(path.join(s.dir, "labshelf.bib"))).rejects.toThrow();
  });

  it("cancels on Escape", async () => {
    const s = await setup({ yaml: LATEX });
    const { code } = await s.run("\x1b", { format: "latex" });
    expect(code).toBe(1);
    expect(s.out).toEqual([]);
  });

  it("exits 1 when the query matches nothing and enter is pressed", async () => {
    const s = await setup({ yaml: LATEX });
    const { code } = await s.run(`zzzzqq${ENTER}${CTRL_C}`, { format: "latex" });
    expect(code).toBe(1);
    expect(s.out).toEqual([]);
  });

  it("rejects an unknown format before opening the picker", async () => {
    const s = await setup({ yaml: LATEX });
    await expect(s.run(ENTER, { format: "word" })).rejects.toBeInstanceOf(UsageError);
  });
});
