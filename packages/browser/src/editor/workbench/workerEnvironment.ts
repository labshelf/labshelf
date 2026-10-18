// Points the workbench at the worker files the build emits, so no worker starts from a blob: URL the extension CSP refuses.
import { registerAssets } from "@codingame/monaco-vscode-api/assets";
import { EXTENSION_HOST_IFRAME, WORKER_FILES } from "../workers";

const IFRAME_MODULE = "vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html";

const pageUrl = (file: string): string => new URL(file, location.href).toString();

/** Call after the extensions service override is imported: its own iframe registration must be the one replaced. */
export function installWorkerEnvironment(): void {
  // PLATFORM: returning a Worker from getWorker skips monaco-vscode-api's blob: trampoline; the built worker files need none.
  (globalThis as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker: (_moduleId: string, label: string) => {
      const file = WORKER_FILES[label];
      return file === undefined ? undefined : new Worker(pageUrl(file), { type: "module", name: label });
    },
    getWorkerUrl: (_moduleId: string, label: string) => {
      const file = WORKER_FILES[label];
      return file === undefined ? undefined : pageUrl(file);
    },
    getWorkerOptions: (_moduleId: string, label: string) => (WORKER_FILES[label] === undefined ? undefined : { type: "module" }),
  };
  registerAssets({ [IFRAME_MODULE]: pageUrl(EXTENSION_HOST_IFRAME) });
}
