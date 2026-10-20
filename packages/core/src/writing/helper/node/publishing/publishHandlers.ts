// Runs template publication over authenticated helper sockets.
import type { HelperLogger } from "../log/index.js";
import { submitTemplatePullRequest, readGitHubIdentity } from "../../../../github/index.js";
import { createPublishHost, type PublishPorts } from "../../../templates/publishing/index.js";
import { savePublishedTemplate } from "../../../templates/node/index.js";
import type { PublishFile } from "../../../templates/index.js";
import type { ProjectBuildDeps } from "../../../build/node/index.js";
import { PROTOCOL_VERSION, type ToHelperMessage } from "../../index.js";
import type { HelperHandler, HelperSend } from "../dispatch/index.js";
import { helperToolchainPrompt } from "../build/index.js";
import { createPreviewRenderer } from "./previewRenderer.js";
import { publicationProject } from "./publishProject.js";
import { checkPublishSnapshot } from "./publishSnapshot.js";
import { buildPublication } from "./publishBuild.js";

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
  const deps = { ...options.build, prompt: helperToolchainPrompt(request.id, send) };
  let submitted: PublishFile[] = [];
  const ports: PublishPorts = {
    logger: options.logger,
    post: (event) => {
      if (event.type === "notice" || event.type.startsWith("publish.")) send({ v: PROTOCOL_VERSION, id: request.id, type: "templatePublish", event: event as import("../../publishing/index.js").TemplatePublishEvent, done: false });
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
    submit: async (input) => { const result = await submitTemplatePullRequest({ ...input, fetch: options.fetch }); submitted = input.files; return result; },
    saveToMyTemplates: async (_project, manifest) => { await savePublishedTemplate(libraryRoot, manifest, submitted); },
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
      const text = error instanceof Error ? error.message : String(error);
      send({ v: PROTOCOL_VERSION, id: message.id, type: "templatePublish", done: false, event: { type: "notice", kind: "error", text } });
      if (message.action !== "open") send({ v: PROTOCOL_VERSION, id: message.id, type: "templatePublish", done: false, event: { type: "publish.failed", error: text } });
    } finally {
      send({ v: PROTOCOL_VERSION, id: message.id, type: "templatePublish", done: true });
    }
  };
  return { handlers: { publishTemplate, templateThumbnail: previews.receive }, dispose: () => { lifetime.abort(); previews.dispose(); } };
}
