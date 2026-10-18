// Composition root of LabShelf Helper, the native-messaging host the browser extension launches to build LaTeX projects.
// CONTRACT: documents/contracts/helper.md#transport
import * as os from "node:os";
import * as path from "node:path";

import type { TexStatus } from "@labshelf/core/helper";

import { createBuildHandlers, systemTexProvider, type TexProvider } from "./build/index.js";
import { createDispatcher, createHelloHandler, runHelperLoop } from "./dispatch/index.js";
import { createHelperLogger } from "./log/index.js";
import { createProjectMirror } from "./mirror/index.js";
import { createFrameWriter } from "./stdio/index.js";

const HELPER_VERSION = "0.1.0";

// CONTRACT: documents/contracts/helper.md#data-folder
function helperDataDir(env: NodeJS.ProcessEnv): string {
  if (process.platform === "darwin") { return path.join(os.homedir(), "Library", "Application Support", "LabShelf Helper"); }
  if (process.platform === "win32") { return path.join(env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local"), "LabShelf Helper"); }
  return path.join(env["XDG_DATA_HOME"] || path.join(os.homedir(), ".local", "share"), "labshelf-helper");
}

async function texStatus(tex: TexProvider): Promise<TexStatus> {
  return (await tex.resolve("pdflatex")) === "missing" ? { source: "none", complete: false } : { source: "system", complete: true };
}

async function main(): Promise<void> {
  const dataDir = helperDataDir(process.env);
  const logger = createHelperLogger(dataDir);
  const send = createFrameWriter(process.stdout, logger);
  // INVARIANT: stdout carries frames only, so nothing in the helper may call console.log.
  const projectsRoot = path.join(dataDir, "projects");
  const tex = systemTexProvider();
  const mirror = createProjectMirror({ projectsRoot, logger });
  const builds = createBuildHandlers({ projectsRoot, sourceDir: (projectId) => mirror.sourceDir(projectId), tex, logger });
  const dispatcher = createDispatcher(
    {
      hello: createHelloHandler({ helperVersion: HELPER_VERSION, tex: await texStatus(tex) }),
      sync: mirror.sync, file: mirror.file, delete: mirror.delete, build: builds.build, cancel: builds.cancel,
    },
    send,
    logger,
  );
  await logger.log("INFO", "helper", "Helper started", { version: HELPER_VERSION, dataDir });
  await runHelperLoop(process.stdin, dispatcher, logger);
  await logger.log("INFO", "helper", "Input closed; helper exits");
}

main().then(
  () => { process.exitCode = 0; },
  () => { process.exitCode = 1; },
);
