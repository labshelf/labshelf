// Composition root of LabShelf Helper, the native-messaging host the browser extension launches to build LaTeX projects.
// CONTRACT: documents/contracts/helper.md#transport
import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

import { createBuildHandlers, systemTexProvider } from "./build/index.js";
import { createDispatcher, createHelloHandler, runHelperLoop } from "./dispatch/index.js";
import { createHelperLogger } from "./log/index.js";
import { createProjectMirror } from "./mirror/index.js";
import { registerHelper, unregisterHelper, type RegResult } from "./register/index.js";
import { createFrameWriter } from "./stdio/index.js";
import { createManagedTexProvider, createTexInstallHandlers, installTexLive, installTinyTex } from "./tex/index.js";
import { createSelfUpdater } from "./update/index.js";

const HELPER_VERSION = "0.1.1";

// CONTRACT: documents/contracts/helper.md#data-folder
function helperDataDir(env: NodeJS.ProcessEnv): string {
  if (process.platform === "darwin") { return path.join(os.homedir(), "Library", "Application Support", "LabShelf Helper"); }
  if (process.platform === "win32") { return path.join(env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local"), "LabShelf Helper"); }
  return path.join(env["XDG_DATA_HOME"] || path.join(os.homedir(), ".local", "share"), "labshelf-helper");
}

function runReg(args: string[]): Promise<RegResult> {
  return new Promise((resolve) => {
    execFile("reg.exe", args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

async function main(): Promise<number | undefined> {
  const dataDir = helperDataDir(process.env);
  const logger = createHelperLogger(dataDir);
  const flag = process.argv[2];
  if (flag === "--register" || flag === "--unregister") {
    const deps = { platform: process.platform, homeDir: os.homedir(), env: process.env, dataDir, binaryPath: process.execPath, logger, runReg };
    return flag === "--register" ? registerHelper(deps) : unregisterHelper(deps);
  }
  const updater = createSelfUpdater({
    currentVersion: HELPER_VERSION, platform: process.platform, arch: process.arch, binaryPath: process.execPath,
    dataDir, fetchImpl: fetch, now: Date.now, logger,
  });
  await updater.cleanupAfterRestart();
  const send = createFrameWriter(process.stdout, logger);
  // INVARIANT: stdout carries frames only, so nothing in the helper may call console.log.
  const projectsRoot = path.join(dataDir, "projects");
  const installDeps = { fetchImpl: fetch, logger };
  const tex = createManagedTexProvider({
    dataDir, logger, system: systemTexProvider(),
    installers: { tinytex: (run) => installTinyTex(installDeps, run), texlive: (run) => installTexLive(installDeps, run) },
  });
  const mirror = createProjectMirror({ projectsRoot, logger });
  const builds = createBuildHandlers({ projectsRoot, sourceDir: (projectId) => mirror.sourceDir(projectId), tex, logger });
  const dispatcher = createDispatcher(
    {
      // An install changes ready.tex, so hello reads the status on every request.
      hello: async (message, reply) => {
        await createHelloHandler({ helperVersion: HELPER_VERSION, tex: await tex.status() })(message, reply);
        // The update runs after ready and is throttled to once a day; a replaced binary takes effect on the next launch.
        updater.checkInBackground();
      },
      sync: mirror.sync, file: mirror.file, delete: mirror.delete, build: builds.build, cancel: builds.cancel,
      ...createTexInstallHandlers({ tex, helperVersion: HELPER_VERSION, logger }),
    },
    send,
    logger,
  );
  await logger.log("INFO", "helper", "Helper started", { version: HELPER_VERSION, dataDir });
  await runHelperLoop(process.stdin, dispatcher, logger);
  await logger.log("INFO", "helper", "Input closed; helper exits");
  return undefined;
}

main().then(
  (code) => { process.exitCode = code ?? 0; },
  () => { process.exitCode = 1; },
);
