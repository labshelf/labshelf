/// <reference lib="dom" />
// Tests the compiled deck's Style preview in VS Code: the host handler that compiles a build copy outside the user's folder, and the webview port that decodes its answer.
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createStylePreviewHandler, type StylePreviewCompilers, type StylePreviewHandler, type StylePreviewRequest } from "../../../src/writing/sourceEditor/deckStylePreview";
import { mountWorkspaceInWebview } from "../../../src/writing/sourceEditor/webview/deckWorkspacePorts";

jest.mock("@labshelf/core/deckWorkspace", () => ({ mountDeckWorkspace: jest.fn(async (_root: unknown, ports: unknown) => ({ ports })) }));

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
const PDF = Buffer.from("%PDF-1.7 fake");

let tmp: string;
let projectFolder: string;
let buildDir: string;

type Format = "typst" | "latex";
const projectOf = (format: Format): StylePreviewRequest["project"] =>
  ({ kind: "ready", folder: projectFolder, main: "talk.tex", settings: { id: "p1", format, engine: "pdflatex" } }) as unknown as StylePreviewRequest["project"];

const requestOf = (format: Format, over: Partial<StylePreviewRequest> = {}): StylePreviewRequest => ({
  project: projectOf(format), root: format === "typst" ? "talk/main.typ" : "talk/main.tex", path: "talk", text: "COPY TEXT", key: "abc12345", ...over,
});

const cacheDir = (): string => path.join(buildDir, "style-preview");

function build(compilers: { typst: jest.Mock; latex: jest.Mock }, resolve: () => Promise<unknown> = async () => ({ engine: "pdflatex", executable: "latexmk" })): StylePreviewHandler {
  return createStylePreviewHandler({
    logger: logger as never, buildDir: () => buildDir, tex: { resolve } as never, typst: { get: async () => ({ session: {}, packages: {} }) } as never, compilers: compilers as unknown as StylePreviewCompilers,
  });
}

const typstThatWrites = (): jest.Mock => jest.fn(async (request: { outputs: readonly string[] }) => {
  await fs.mkdir(path.dirname(request.outputs[0]!), { recursive: true });
  await fs.writeFile(request.outputs[0]!, PDF);
  return { status: "succeeded", pdf: request.outputs[0]!, problems: [], cites: [] };
});

const latexThatBuilds = (): jest.Mock => jest.fn(async (request: { projectFolder: string; main: string }) => {
  const pdf = path.join(request.projectFolder, request.main.replace(/\.tex$/, ".pdf"));
  await fs.writeFile(pdf, PDF);
  return { status: "succeeded", pdf, problems: [] };
});

const neverCalled = (): jest.Mock => jest.fn(async () => { throw new Error("must not compile"); });

async function listAll(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    out.push(...(entry.isDirectory() ? await listAll(full) : [full]));
  }
  return out;
}

beforeEach(async () => {
  jest.clearAllMocks();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "style-preview-"));
  projectFolder = path.join(tmp, "project");
  buildDir = path.join(tmp, "build", "p1");
  await fs.mkdir(path.join(projectFolder, "talk"), { recursive: true });
  await fs.writeFile(path.join(projectFolder, "talk", "main.typ"), "ORIGINAL");
  await fs.writeFile(path.join(projectFolder, "talk", "main.tex"), "ORIGINAL");
});

afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe("a Typst request", () => {
  it("4.3a compiles the copy as an in-memory source and writes only the cache file", async () => {
    const typst = typstThatWrites();
    const answer = await build({ typst, latex: neverCalled() })(requestOf("typst"));

    expect(answer).toBe(PDF.toString("base64"));
    const call = typst.mock.calls[0]![0] as { sources: Map<string, string>; outputs: string[]; main: string; projectFolder: string };
    expect(call.projectFolder).toBe(projectFolder);
    expect(call.main).toBe("talk/main.typ");
    expect([...call.sources]).toEqual([[path.join(projectFolder, "talk", "main.typ"), "COPY TEXT"]]);
    expect(call.outputs).toEqual([path.join(cacheDir(), "abc12345.pdf")]);
    expect(await fs.readFile(path.join(projectFolder, "talk", "main.typ"), "utf8")).toBe("ORIGINAL");
    expect(await listAll(projectFolder)).toHaveLength(2);
    expect(await listAll(buildDir)).toEqual([path.join(cacheDir(), "abc12345.pdf")]);
  });

  it("4.3a answers a second request with the same key from the cache without compiling", async () => {
    const typst = typstThatWrites();
    const handler = build({ typst, latex: neverCalled() });
    await handler(requestOf("typst"));
    const again = await handler(requestOf("typst"));

    expect(again).toBe(PDF.toString("base64"));
    expect(typst).toHaveBeenCalledTimes(1);
  });

  it("4.3a answers from a cache file an earlier session left", async () => {
    await fs.mkdir(cacheDir(), { recursive: true });
    await fs.writeFile(path.join(cacheDir(), "abc12345.pdf"), "OLD");
    const typst = neverCalled();
    expect(await build({ typst, latex: neverCalled() })(requestOf("typst"))).toBe(Buffer.from("OLD").toString("base64"));
    expect(typst).not.toHaveBeenCalled();
  });

  it("returns undefined when the compile fails, and caches nothing", async () => {
    const typst = jest.fn(async () => ({ status: "failed", problems: [] }));
    expect(await build({ typst, latex: neverCalled() })(requestOf("typst"))).toBeUndefined();
    expect(await listAll(buildDir)).toEqual([]);
  });

  it("returns undefined when the compiler throws, and logs it", async () => {
    const typst = jest.fn(async () => { throw new Error("wasm gone"); });
    expect(await build({ typst, latex: neverCalled() })(requestOf("typst"))).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("refuses a key that is not a plain name, so no file leaves the cache folder", async () => {
    const typst = typstThatWrites();
    expect(await build({ typst, latex: neverCalled() })(requestOf("typst", { key: "../../evil" }))).toBeUndefined();
    expect(typst).not.toHaveBeenCalled();
  });

  it("keeps at most 16 cached PDFs, deleting the oldest", async () => {
    const handler = build({ typst: typstThatWrites(), latex: neverCalled() });
    await fs.mkdir(cacheDir(), { recursive: true });
    for (let i = 0; i < 16; i++) {
      const file = path.join(cacheDir(), `old${String(i).padStart(2, "0")}.pdf`);
      await fs.writeFile(file, "x");
      await fs.utimes(file, new Date(1000 + i * 1000), new Date(1000 + i * 1000));
    }
    await handler(requestOf("typst", { key: "fresh001" }));

    const names = (await fs.readdir(cacheDir())).sort();
    expect(names).toHaveLength(16);
    expect(names).toContain("fresh001.pdf");
    expect(names).not.toContain("old00.pdf");
    expect(names).toContain("old15.pdf");
  });

  it("serialises requests and drops a queued one that a newer request for the same file replaced", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const typst = jest.fn(async (request: { outputs: readonly string[]; sources: Map<string, string> }) => {
      order.push([...request.sources.values()][0]!);
      if (order.length === 1) await gate;
      await fs.mkdir(path.dirname(request.outputs[0]!), { recursive: true });
      await fs.writeFile(request.outputs[0]!, PDF);
      return { status: "succeeded", pdf: request.outputs[0]!, problems: [], cites: [] };
    });
    const handler = build({ typst, latex: neverCalled() });

    const first = handler(requestOf("typst", { key: "aaaa0001", text: "one" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = handler(requestOf("typst", { key: "aaaa0002", text: "two" }));
    const third = handler(requestOf("typst", { key: "aaaa0003", text: "three" }));
    release();

    expect(await first).toBe(PDF.toString("base64"));
    expect(await second).toBeUndefined();
    expect(await third).toBe(PDF.toString("base64"));
    expect(order).toEqual(["one", "three"]);
  });
});

describe("a LaTeX request", () => {
  it("4.3b writes the copy only under style-preview, builds with TEXINPUTS on the project folder and returns the PDF", async () => {
    let inputs: string | undefined;
    let seen: string[] = [];
    const latex = jest.fn(async (request: { projectFolder: string; main: string; outDir: string; env?: NodeJS.ProcessEnv }) => {
      inputs = request.env?.["TEXINPUTS"];
      seen = await listAll(request.projectFolder);
      expect(await fs.readFile(path.join(request.projectFolder, request.main), "utf8")).toBe("COPY TEXT");
      const pdf = path.join(request.outDir, "main.pdf");
      await fs.writeFile(pdf, PDF);
      return { status: "succeeded", pdf, problems: [] };
    });
    const before = process.env["TEXINPUTS"];
    const answer = await build({ typst: neverCalled(), latex })(requestOf("latex"));

    expect(answer).toBe(PDF.toString("base64"));
    const call = latex.mock.calls[0]![0] as { projectFolder: string; main: string; outDir: string };
    expect(call.projectFolder).toBe(path.join(cacheDir(), "abc12345"));
    expect(call.main).toBe("main.tex");
    expect(call.outDir).toBe(call.projectFolder);
    expect(inputs?.startsWith(`${path.join(projectFolder, "talk")}//${path.delimiter}`)).toBe(true);
    expect(seen).toEqual([path.join(call.projectFolder, "main.tex")]);
    expect(process.env["TEXINPUTS"]).toBe(before);
    expect(await fs.readFile(path.join(projectFolder, "talk", "main.tex"), "utf8")).toBe("ORIGINAL");
    expect(await listAll(projectFolder)).toHaveLength(2);
    expect(await listAll(buildDir)).toEqual([path.join(cacheDir(), "abc12345.pdf")]);
  });

  it("4.3b keeps the TEXINPUTS the environment already had after the new entry", async () => {
    process.env["TEXINPUTS"] = "/elsewhere//:";
    try {
      let inputs: string | undefined;
      const latex = jest.fn(async (request: { projectFolder: string; env?: NodeJS.ProcessEnv }) => {
        inputs = request.env?.["TEXINPUTS"];
        const pdf = path.join(request.projectFolder, "main.pdf");
        await fs.writeFile(pdf, PDF);
        return { status: "succeeded", pdf, problems: [] };
      });
      await build({ typst: neverCalled(), latex })(requestOf("latex"));
      expect(inputs).toBe(`${path.join(projectFolder, "talk")}//${path.delimiter}/elsewhere//:`);
      expect(process.env["TEXINPUTS"]).toBe("/elsewhere//:");
    } finally { delete process.env["TEXINPUTS"]; }
  });

  it("4.3b returns undefined without building when the toolchain is missing", async () => {
    const latex = neverCalled();
    expect(await build({ typst: neverCalled(), latex }, async () => "missing")(requestOf("latex"))).toBeUndefined();
    expect(latex).not.toHaveBeenCalled();
    expect(await listAll(buildDir)).toEqual([]);
  });

  it("4.3b returns undefined for a failed build and removes the work folder", async () => {
    const latex = jest.fn(async () => ({ status: "failed", problems: [{ severity: "error", message: "boom", file: "main.tex" }] }));
    expect(await build({ typst: neverCalled(), latex })(requestOf("latex"))).toBeUndefined();
    expect(await listAll(buildDir)).toEqual([]);
    expect(await fs.readdir(cacheDir())).toEqual([]);
  });

  it("4.3b answers a repeated key from the cache without building", async () => {
    const latex = latexThatBuilds();
    const handler = build({ typst: neverCalled(), latex });
    await handler(requestOf("latex", { root: "main.tex" }));
    expect(await handler(requestOf("latex", { root: "main.tex" }))).toBe(PDF.toString("base64"));
    expect(latex).toHaveBeenCalledTimes(1);
  });
});

describe("the webview port", () => {
  async function portsWith(request: jest.Mock): Promise<{ stylePreview: (r: { text: string; page: number; key: string }) => Promise<ArrayBuffer | undefined> }> {
    const mounted = await mountWorkspaceInWebview({
      root: {} as never, card: {} as never, path: "/proj/talk/main.tex", editing: {} as never, flush: async () => undefined,
      subscribe: (() => () => undefined) as never, ports: { request: async (method: string, params: unknown) => (method === "deckAssets" ? {} : request(method, params)), runAction: jest.fn() } as never,
      builds: {} as never, state: { getState: () => undefined, setState: () => undefined },
    });
    return (mounted as unknown as { ports: never }).ports;
  }

  it("4.3c sends path, text, page and key and decodes the base64 answer to an ArrayBuffer", async () => {
    const request = jest.fn(async () => PDF.toString("base64"));
    const ports = await portsWith(request);
    const bytes = await ports.stylePreview({ text: "T", page: 3, key: "k1" });

    expect(request).toHaveBeenCalledWith("deckStylePreview", { path: "/proj/talk/main.tex", text: "T", page: 3, key: "k1" });
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(bytes!).toString()).toBe(PDF.toString());
  });

  it("4.3c keeps an undefined answer undefined, whether null or a failed request", async () => {
    expect(await (await portsWith(jest.fn(async () => null))).stylePreview({ text: "T", page: 1, key: "k" })).toBeUndefined();
    expect(await (await portsWith(jest.fn(async () => { throw new Error("gone"); }))).stylePreview({ text: "T", page: 1, key: "k" })).toBeUndefined();
  });
});
