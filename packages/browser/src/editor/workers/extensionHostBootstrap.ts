// Starts the extension host worker without a blob: trampoline: sets the globals VS Code's trampoline would, then imports the host.
interface BootstrapMessage {
  type: "__bootstrap";
  workerUrl: string;
  fileRoot: string;
  nlsMessages: unknown;
  nlsLanguage: unknown;
}

const scope = globalThis as unknown as DedicatedWorkerGlobalScope & Record<string, unknown>;
// INVARIANT: the iframe posts the bootstrap message first, but host messages that race it are replayed after the import.
const queued: MessageEvent[] = [];

scope.onmessage = async (event: MessageEvent) => {
  const data = event.data as Partial<BootstrapMessage> | undefined;
  if (data?.type !== "__bootstrap" || data.workerUrl === undefined) {
    queued.push(event);
    return;
  }
  scope.onmessage = null;
  scope._VSCODE_NLS_MESSAGES = data.nlsMessages;
  scope._VSCODE_NLS_LANGUAGE = data.nlsLanguage;
  scope._VSCODE_FILE_ROOT = data.fileRoot;
  await import(/* webpackIgnore: true */ data.workerUrl);
  for (const early of queued) scope.dispatchEvent(new MessageEvent("message", { data: early.data, ports: [...early.ports] }));
};
