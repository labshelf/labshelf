// Names the worker files the build emits next to the editor page, by the label the workbench asks for.
export const WORKER_FILES: Readonly<Record<string, string>> = {
  editorWorkerService: "workers/editorWorker.js",
  TextMateWorker: "workers/textMateWorker.js",
  extensionHostWorkerMain: "workers/extensionHostWorker.js",
};

/** The extension host's iframe, rewritten by the build so its worker starts without a blob: URL. */
export const EXTENSION_HOST_IFRAME = "workers/extensionHostIframe.html";
