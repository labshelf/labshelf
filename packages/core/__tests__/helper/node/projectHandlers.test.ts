/** Pins the helper's project handlers: template publication (checks, isolated builds, submission, exact local saves) and the TeX install handlers (progress frames, then ready or an error code). */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { buildProject } from "../../../src/writing/build/node/index";
import { publishTemplatePullRequest } from "../../../src/templates/index";
import { createTemplatePublishHandlers, createTexInstallHandlers } from "../../../src/helper/node/projectHandlers";
import { PROTOCOL_VERSION, type ToHelperMessage, type ToPageMessage, type TemplatePublishRequest } from "../../../src/helper/index";
import type { ILogger } from "../../../src/ports/index.js";
import type { ProjectBuildDeps } from "../../../src/writing/build/node/index";
import { TexInstallError, type ManagedTexProvider } from "../../../src/latex/node/index";

jest.mock("../../../src/writing/build/node/index", () => ({ ...jest.requireActual("../../../src/writing/build/node/index"), buildProject: jest.fn() }));
jest.mock("../../../src/templates/index", () => ({ ...jest.requireActual("../../../src/templates/index"), publishTemplatePullRequest: jest.fn() }));

describe("template publish handlers", () => {
  const draft = { name: "Research", category: "article", license: "MIT", description: "A paper template" };
  const pdf = new Uint8Array([37, 80, 68, 70]);
  const png = new Uint8Array(33);
  png.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(png.buffer).setUint32(16, 800);
  new DataView(png.buffer).setUint32(20, 100);
  let root: string;
  let library: string;
  let project: string;
  let config: string;
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}), redact: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    root = await fs.mkdtemp(path.join(tmpdir(), "labshelf-publish-"));
    library = path.join(root, "library"); project = path.join(library, "projects", "paper"); config = path.join(root, "config.json");
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(config, JSON.stringify({ libraryRoot: library }));
    await fs.writeFile(path.join(project, "labshelf.yaml"), "id: paper\nformat: latex\nmain: main.tex\nengine: xelatex\n");
    await fs.writeFile(path.join(project, "main.tex"), "original source");
    jest.mocked(buildProject).mockImplementation(async (entry) => {
      expect(entry.folder).not.toBe(project);
      expect(entry.settings.engine).toBe("xelatex");
      await fs.writeFile(path.join(project, "main.tex"), "edited during build");
      await fs.writeFile(path.join(entry.folder, "main.pdf"), pdf);
      return { status: "succeeded", problems: [] } as never;
    });
    jest.mocked(publishTemplatePullRequest).mockResolvedValue({ url: "https://github.com/labshelf/labshelf-templates/pull/7", branch: "template/research-date" });
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  function harness(thumbnail = png) {
    const events: ToPageMessage[] = [];
    const fetch = jest.fn(async () => ({ ok: true, json: async () => ({ login: "researcher" }) })) as unknown as typeof globalThis.fetch;
    const publisher = createTemplatePublishHandlers({ dataDir: path.join(root, "data"), sharedConfigFile: config, logger, fetch,
      build: { logger } as unknown as Omit<ProjectBuildDeps, "prompt" | "projects"> });
    const send = (event: ToPageMessage) => {
      events.push(event);
      if (event.type === "templatePreview") void publisher.handlers.templateThumbnail({ v: PROTOCOL_VERSION, id: "thumbnail", type: "templateThumbnail", requestId: event.id }, send, thumbnail);
    };
    const run = (request: TemplatePublishRequest, id = "publish") => publisher.handlers.publishTemplate({ v: PROTOCOL_VERSION, id, type: "publishTemplate", projectId: "paper", ...request }, send);
    return { publisher, events, run, fetch };
  }

  it("opens a project using its declared engine without building or contacting GitHub", async () => {
    const h = harness(); await h.run({ action: "open" });
    expect(h.events).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ type: "publish.open", project: expect.objectContaining({ engineLabel: "XeLaTeX" }) }) }));
    expect(buildProject).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
  });

  it("submits the checked snapshot and saves its exact files and previews in My templates", async () => {
    const h = harness(); await h.run({ action: "submit", draft, token: "secret-token" });
    const submission = jest.mocked(publishTemplatePullRequest).mock.calls[0]?.[0];
    expect(submission?.files.find((f) => f.path === "files/main.tex")?.bytes).toEqual(new TextEncoder().encode("original source"));
    expect(submission?.files.some((f) => f.path.includes("build/") || f.path === "files/labshelf.yaml")).toBe(false);
    expect(await fs.readFile(path.join(library, "templates/research/files/main.tex"), "utf8")).toBe("original source");
    expect(new Uint8Array(await fs.readFile(path.join(library, "templates/research/preview/thumbnail.png")))).toEqual(png);
    expect(new Uint8Array(await fs.readFile(path.join(library, "templates/research/preview/sample.pdf")))).toEqual(pdf);
    expect(h.events).toContainEqual(expect.objectContaining({ event: { type: "publish.submitted", url: "https://github.com/labshelf/labshelf-templates/pull/7" } }));
    expect(await fs.readdir(path.join(root, "data/publishing"))).toEqual([]);
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain("secret-token");
  });

  it.each(["symlink", "hardlink", "latexmkrc"])("refuses %s before compiling or sending files", async (kind) => {
    const other = path.join(root, "outside.tex"); await fs.writeFile(other, "outside");
    if (kind === "symlink") await fs.symlink(other, path.join(project, "unsafe.tex"));
    else if (kind === "hardlink") await fs.link(other, path.join(project, "unsafe.tex"));
    else await fs.writeFile(path.join(project, ".latexmkrc"), "exec('bad')");
    const h = harness(); await h.run({ action: "submit", draft, token: "token" });
    expect(buildProject).not.toHaveBeenCalled(); expect(publishTemplatePullRequest).not.toHaveBeenCalled();
    expect(h.events).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ type: "publish.failed" }) }));
  });

  it("refuses a project folder that resolves outside the library", async () => {
    await fs.rename(project, path.join(root, "outside")); await fs.symlink(path.join(root, "outside"), project);
    const h = harness(); await h.run({ action: "open" });
    expect(h.events).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ type: "notice", kind: "error" }) }));
    expect(buildProject).not.toHaveBeenCalled();
  });

  it("refuses an invalid thumbnail before submission", async () => {
    const h = harness(new Uint8Array([1, 2])); await h.run({ action: "submit", draft, token: "token" });
    expect(publishTemplatePullRequest).not.toHaveBeenCalled();
    expect(h.events).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ type: "publish.checks", checks: expect.arrayContaining([expect.objectContaining({ id: "thumbnail", ok: false })]) }) }));
  });

  it("reruns checks on submission after sources change since the check request", async () => {
    const h = harness(); await h.run({ action: "check", draft }, "check");
    await fs.writeFile(path.join(project, "latexmkrc"), "unsafe");
    await h.run({ action: "submit", draft, token: "token" }, "submit");
    expect(buildProject).toHaveBeenCalledTimes(1); expect(publishTemplatePullRequest).not.toHaveBeenCalled();
  });
});

describe("TeX install handlers", () => {
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
  const status = { source: "tinytex" as const, year: 2026, complete: true };

  function fakeTex(overrides: Partial<ManagedTexProvider>): ManagedTexProvider {
    return {
      resolve: jest.fn(), installMissing: jest.fn(), status: jest.fn(async () => status),
      install: jest.fn(async (_kind, onProgress) => { onProgress(0.5); onProgress(null); return status; }),
      installAllPackages: jest.fn(async (onProgress) => { onProgress(0.25); return status; }),
      ...overrides,
    };
  }

  async function handle(tex: ManagedTexProvider, message: ToHelperMessage): Promise<ToPageMessage[]> {
    const sent: ToPageMessage[] = [];
    const handlers = createTexInstallHandlers({ tex, helperVersion: "0.1.0", host: "helper", logger });
    const handler = message.type === "installTex" ? handlers.installTex : handlers.installAllPackages;
    await handler(message, (frame) => sent.push(frame));
    return sent;
  }

  const installTex: ToHelperMessage = { v: PROTOCOL_VERSION, id: "3", type: "installTex", kind: "tinytex" };
  const installAll: ToHelperMessage = { v: PROTOCOL_VERSION, id: "4", type: "installAllPackages" };

  it("streams installing-tex progress, then ready with the status", async () => {
    const sent = await handle(fakeTex({}), installTex);
    expect(sent.map((frame) => frame.type)).toEqual(["progress", "progress", "ready"]);
    expect(sent[0]).toMatchObject({ id: "3", phase: "installing-tex", fraction: 0.5 });
    expect(sent[1]).not.toHaveProperty("fraction");
    expect(sent[2]).toEqual({ v: PROTOCOL_VERSION, id: "3", type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "0.1.0", host: "helper", tex: status });
  });

  it("streams installing-package progress, then ready", async () => {
    const sent = await handle(fakeTex({}), installAll);
    expect(sent[0]).toMatchObject({ id: "4", type: "progress", phase: "installing-package", fraction: 0.25 });
    expect(sent.at(-1)).toMatchObject({ id: "4", type: "ready", tex: status });
  });

  it.each(["texlive-rollover", "no-managed-tex"] as const)("replies error %s", async (code) => {
    const sent = await handle(fakeTex({ installAllPackages: jest.fn(async () => { throw new TexInstallError(code, "stop"); }) }), installAll);
    expect(sent.at(-1)).toEqual({ v: PROTOCOL_VERSION, id: "4", type: "error", code, message: "stop" });
  });

  it("replies tex-install-failed with the cause for any other failure", async () => {
    const sent = await handle(fakeTex({ install: jest.fn(async () => { throw new Error("download failed: 404"); }) }), installTex);
    expect(sent.at(-1)).toMatchObject({ id: "3", type: "error", code: "tex-install-failed", message: expect.stringContaining("download failed: 404") });
  });
});
