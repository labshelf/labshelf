// Answers the socket's project, template publication and TeX install messages: open, close, edit and save against the
// library's project folders, publication over authenticated sockets, and the installs that stream progress to `ready` or `error`.
// CONTRACT: documents/contracts/helper.md#messages
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { constants, promises as fs } from "node:fs";

import type { ILogger } from "../../ports/index.js";
import { publishTemplatePullRequest, readGitHubIdentity } from "../../templates/index.js";
import { createPublishHost, type PublishPorts, type PublishableProject } from "../../templates/index.js";
import { writePublishedTemplate, checkTemplateForPublish, runSourceChecks } from "../../templates/node/index.js";
import type {
  PublishFile,
  PublishBuildResult,
  PublishCheckInput,
  PublishCheckReport,
} from "../../templates/index.js";
import { type ProjectBuildDeps, buildProject } from "../../writing/build/node/index.js";
import { deriveBuiltPdfPath } from "../../writing/build/index.js";
import { readSharedLibraryRoot } from "../../library/node/index.js";
import { resolveInLibrary } from "../../bridge/node/index.js";
import { readProject } from "../../writing/project/index.js";
import { createNodeProjectReadCompositionRoot } from "../../writing/project/node/index.js";
import { formatEngineLabel } from "../../latex/index.js";
import { TEX_MODULE, TexInstallError, type ManagedTexProvider, type TexProgress } from "../../latex/node/index.js";
import { deriveTemplateTreeProblem } from "../../templates/templateManifest/index.js";
import { formatError } from "../../errors/index.js";
import { PROTOCOL_VERSION, type HelperHost, type HelperPhase, type TexToolchain, type ToHelperMessage } from "../index.js";
import type { HelperHandler, HelperSend } from "./helperHandlers.js";
import { createHelperToolchainAsk } from "./helperBuild.js";
import type { LibraryProjects } from "./helperProjects.js";
import type { HelperLogger } from "./helperPrivacy.js";

// --- Project handlers: open, close, edit and save ---

type MessageOf<T extends ToHelperMessage["type"]> = Extract<ToHelperMessage, { type: T }>;

export interface ProjectHandlerOptions {
  dataDir: string;
  projects: LibraryProjects;
  /** Drops the project's build state, so the next `pages` after open carries every page. */
  forgetBuilds(projectId: string): void;
}

export type ProjectHandlers = Record<"openProject" | "closeProject" | "edit" | "save", HelperHandler>;

export function createProjectHandlers(options: ProjectHandlerOptions): ProjectHandlers {
  const { dataDir, projects, forgetBuilds } = options;
  return {
    async openProject(message, send) {
      const { id, projectId, root } = message as MessageOf<"openProject">;
      const { files } = await projects.open(projectId, root);
      forgetBuilds(projectId);
      // The build working copy of an earlier session may hold files the project no longer has.
      await fs.rm(path.join(dataDir, "projects", projectId, "src"), { recursive: true, force: true });
      send({ v: PROTOCOL_VERSION, id, type: "opened", projectId, files });
    },
    async closeProject(message, send) {
      const { id, projectId } = message as MessageOf<"closeProject">;
      await projects.close(projectId);
      forgetBuilds(projectId);
      send({ v: PROTOCOL_VERSION, id, type: "closed", projectId });
    },
    async edit(message) {
      const edit = message as MessageOf<"edit">;
      await projects.edit(edit.projectId, edit.path, edit.version, edit.text === undefined ? { changes: edit.changes } : { text: edit.text });
    },
    async save(message) {
      const { projectId, path: file } = message as MessageOf<"save">;
      await projects.save(projectId, file);
    },
  };
}

// --- Template publication ---

async function checkPublishSnapshot(dataDir: string, input: PublishCheckInput, build: (folder: string) => ReturnType<PublishCheckInput["buildPdf"]>): Promise<PublishCheckReport> {
  const source = await runSourceChecks(input.projectFolder, input.manifest);
  if (!source.files || source.checks.some((c) => !c.ok)) return checkTemplateForPublish(input);
  const root = path.join(dataDir, "publishing");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const staging = await fs.mkdtemp(path.join(root, "template-"));
  const folder = path.join(staging, "src");
  await fs.mkdir(folder);
  try {
    for (const file of source.files) {
      const handle = await fs.open(file.absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Uint8Array;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink > 1 || stat.size > 5 * 1024 * 1024) throw new Error(`Unsafe template file "${file.path}"`);
        bytes = await handle.readFile();
      } finally { await handle.close(); }
      const problem = deriveTemplateTreeProblem([{ ...file, size: bytes.length }]);
      if (problem) throw new Error(problem);
      const target = path.join(folder, ...file.path.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
    return await checkTemplateForPublish({ ...input, projectFolder: folder, buildPdf: () => build(folder) });
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function publicationProject(projectId: string, logger: ILogger, sharedConfigFile?: string): Promise<{ libraryRoot: string; project: PublishableProject }> {
  const libraryRoot = await readSharedLibraryRoot(sharedConfigFile, logger);
  if (!libraryRoot) throw new Error("No library folder is set up on this computer");
  const folder = await resolveInLibrary(libraryRoot, `projects/${projectId}`);
  const entry = await readProject(createNodeProjectReadCompositionRoot(logger), folder, "library");
  if (entry.kind !== "ready" || !entry.main || entry.settings.id !== projectId) throw new Error(`Project "${projectId}" is not ready to publish`);
  await resolveInLibrary(folder, entry.main);
  const { format } = entry.settings;
  const engine = format === "typst" ? "typst" : entry.settings.engine ?? "pdflatex";
  return { libraryRoot, project: { id: projectId, title: entry.settings.title ?? projectId, folder: path.resolve(folder), format, engine, main: entry.main,
    engineLabel: engine === "typst" ? "Typst" : formatEngineLabel(engine) } };
}

async function buildPublication(project: PublishableProject, folder: string, deps: Omit<ProjectBuildDeps, "projects">, signal: AbortSignal): Promise<PublishBuildResult> {
  const settings = { id: project.id, format: project.format, ...(project.engine === "typst" ? {} : { engine: project.engine }) };
  const entry = { kind: "ready" as const, location: "external" as const, folder, settings, main: project.main };
  const result = await buildProject(entry, { ...deps, projects: { projectBuildDir: () => path.join(folder, "..", "build") } }, { mode: "full", force: true, signal });
  if (result.status !== "succeeded") {
    const problems = "problems" in result ? result.problems.filter((p) => p.severity === "error").map((p) => p.message) : [];
    return { ok: false, problems: problems.length ? problems : [`The template build ended with ${result.status}.`] };
  }
  const pdf = deriveBuiltPdfPath(path, entry);
  if (!pdf) throw new Error(`No sample PDF for project "${project.id}"`);
  return { ok: true, pdf: new Uint8Array(await readFile(pdf)) };
}

function createPreviewRenderer() {
  const pending = new Map<string, { resolve(png: Uint8Array): void; reject(error: Error): void }>();
  const receive: HelperHandler = async (message, _send, payload) => {
    if (message.type !== "templateThumbnail") throw new Error("Expected templateThumbnail");
    const request = pending.get(message.requestId);
    if (!request) throw new Error("No publication is waiting for this thumbnail");
    if (message.error) request.reject(new Error(`Rendering the thumbnail failed: ${message.error}`));
    else if (!payload?.length || payload.length > 512 * 1024) request.reject(new Error("The thumbnail must be a PNG at most 512 KiB"));
    else request.resolve(payload);
  };
  const render = async (id: string, send: HelperSend, pdf: Uint8Array): Promise<Uint8Array> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Uint8Array>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        timeout = setTimeout(() => reject(new Error("The browser did not render the template thumbnail within 60 seconds")), 60_000);
        send({ v: PROTOCOL_VERSION, id, type: "templatePreview" }, pdf);
      });
    } finally {
      clearTimeout(timeout);
      pending.delete(id);
    }
  };
  return { render, receive, dispose: () => { for (const request of pending.values()) request.reject(new Error("Helper connection closed")); } };
}

export interface TemplatePublishOptions {
  dataDir: string;
  logger: HelperLogger;
  build: Omit<ProjectBuildDeps, "prompt" | "projects">;
  fetch: typeof globalThis.fetch;
  sharedConfigFile?: string;
}

type Request = Extract<ToHelperMessage, { type: "publishTemplate" }>;

async function runPublication(options: TemplatePublishOptions, request: Request, send: HelperSend, render: (pdf: Uint8Array) => Promise<Uint8Array>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const { project, libraryRoot } = await publicationProject(request.projectId, options.logger, options.sharedConfigFile);
  const deps = { ...options.build, prompt: createHelperToolchainAsk(request.id, send) };
  let submitted: PublishFile[] = [];
  const ports: PublishPorts = {
    logger: options.logger,
    post: (event) => {
      if (event.type === "notice" || event.type.startsWith("publish.")) send({ v: PROTOCOL_VERSION, id: request.id, type: "templatePublish", event: event as import("../helperMessages.js").TemplatePublishEvent, done: false });
    },
    projects: { pick: async () => project, byId: async (id) => id === project.id ? project : undefined },
    auth: { signIn: () => readGitHubIdentity(options.fetch, request.action === "submit" ? request.token : "") },
    buildPdf: () => { throw new Error("Publication builds require a source snapshot"); },
    renderThumbnail: render,
    check: async (input) => {
      const report = await checkPublishSnapshot(options.dataDir, input, (folder) => buildPublication(project, folder, deps, signal));
      if (!report.ok) await options.logger.log("WARN", "helper/publish", "Template publication checks failed", { projectId: project.id, checks: report.checks.filter((check) => !check.ok) });
      return report;
    },
    submit: async (input) => { const result = await publishTemplatePullRequest({ ...input, fetch: options.fetch }); submitted = input.files; return result; },
    saveToMyTemplates: async (_project, manifest) => { await writePublishedTemplate(libraryRoot, manifest, submitted); },
  };
  const host = createPublishHost(ports);
  if (request.action === "open") return host.open(project.id);
  const page = { id: project.id, title: project.title, engineLabel: project.engineLabel };
  if (request.action === "submit") await host.handle({ type: "publish.signIn" });
  await host.handle({ type: request.action === "check" ? "publish.check" : "publish.submit", project: page, draft: request.draft });
}

export function createTemplatePublishHandlers(options: TemplatePublishOptions) {
  const previews = createPreviewRenderer();
  const lifetime = new AbortController();
  const fetch: typeof globalThis.fetch = (url, init) => options.fetch(url, { ...init, signal: AbortSignal.any([lifetime.signal, ...(init?.signal ? [init.signal] : [])]) });
  const publishTemplate: HelperHandler = async (message, send) => {
    if (message.type !== "publishTemplate") throw new Error("Expected publishTemplate");
    if (message.action === "submit") options.logger.redact(message.token);
    await options.logger.log("INFO", "helper/publish", "Template publication requested", { projectId: message.projectId, action: message.action });
    try {
      await runPublication({ ...options, fetch }, message, send, (pdf) => previews.render(message.id, send, pdf), lifetime.signal);
    } catch (error) {
      await options.logger.error("helper/publish", error, { projectId: message.projectId, action: message.action });
      const text = formatError(error);
      send({ v: PROTOCOL_VERSION, id: message.id, type: "templatePublish", done: false, event: { type: "notice", kind: "error", text } });
      if (message.action !== "open") send({ v: PROTOCOL_VERSION, id: message.id, type: "templatePublish", done: false, event: { type: "publish.failed", error: text } });
    } finally {
      send({ v: PROTOCOL_VERSION, id: message.id, type: "templatePublish", done: true });
    }
  };
  return { handlers: { publishTemplate, templateThumbnail: previews.receive }, dispose: () => { lifetime.abort(); previews.dispose(); } };
}

// --- TeX install handlers: `installTex` and `installAllPackages` ---

export interface TexInstallHandlerOptions {
  tex: ManagedTexProvider;
  /** Carried by every `ready`, which the contract requires to be non-empty. */
  helperVersion: string;
  host: HelperHost;
  logger: ILogger;
}

type InstallPhase = Extract<HelperPhase, "installing-tex" | "installing-package">;

const MESSAGES: Record<InstallPhase, string> = {
  "installing-tex": "Installing TeX",
  "installing-package": "Installing every TeX package",
};

async function runInstall(
  options: TexInstallHandlerOptions, id: string, phase: InstallPhase, send: HelperSend,
  install: (onProgress: TexProgress) => Promise<TexToolchain>,
): Promise<void> {
  const onProgress: TexProgress = (fraction) =>
    send({ v: PROTOCOL_VERSION, id, type: "progress", phase, message: MESSAGES[phase], ...(fraction === null ? {} : { fraction }) });
  try {
    const tex = await install(onProgress);
    send({ v: PROTOCOL_VERSION, id, type: "ready", protocol: PROTOCOL_VERSION, helperVersion: options.helperVersion, host: options.host, tex });
  } catch (error) {
    await options.logger.error(TEX_MODULE, error, { step: phase, id });
    const message = formatError(error);
    const code = error instanceof TexInstallError ? error.code : "tex-install-failed";
    send({ v: PROTOCOL_VERSION, id, type: "error", code, message });
  }
}

export function createTexInstallHandlers(options: TexInstallHandlerOptions): { installTex: HelperHandler; installAllPackages: HelperHandler } {
  const { tex } = options;
  const installTex: HelperHandler = async (message, send) => {
    if (message.type !== "installTex") { throw new Error(`installTex handler received ${message.type}`); }
    await runInstall(options, message.id, "installing-tex", send, (onProgress) => tex.install(message.kind, onProgress));
  };
  const installAllPackages: HelperHandler = async (message, send) => {
    if (message.type !== "installAllPackages") { throw new Error(`installAllPackages handler received ${message.type}`); }
    await runInstall(options, message.id, "installing-package", send, (onProgress) => tex.installAllPackages(onProgress));
  };
  return { installTex, installAllPackages };
}
