// Runs Tinymist's language server in a worker, adapted from upstream editors/vscode/src/web/server.ts for a wasm served next to it.
import { BrowserMessageReader, BrowserMessageWriter, createConnection, InitializeRequest } from "vscode-languageserver/browser";
import init, { TinymistLanguageServer } from "tinymist-web";

interface OutgoingRequest { id: number; method: string; params: unknown }
interface OutgoingNotification { method: string; params: unknown }

async function startServer(): Promise<void> {
  const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
  const connection = createConnection(new BrowserMessageReader(scope), new BrowserMessageWriter(scope));
  // PLATFORM: the upstream worker embeds the wasm as base64; the extension CSP allows only 'wasm-unsafe-eval', which
  // covers instantiating it from a fetched URL as well.
  await init({ module_or_path: new URL("tinymist_bg.wasm", scope.location.href) });

  const events: number[] = [];
  const bridge = new TinymistLanguageServer({
    sendEvent: (event: number) => void events.push(event),
    sendRequest({ id, method, params }: OutgoingRequest) {
      connection.sendRequest(method, params)
        .then((result: unknown) => bridge.on_response({ id, result }))
        .catch((error: unknown) => bridge.on_response({ id, error: { code: -32603, message: String(error) } }));
    },
    sendNotification: ({ method, params }: OutgoingNotification) => void connection.sendNotification(method, params),
    // TRAP: Tinymist 0.15.10 requires this hook; it resolves Typst Universe imports (`@preview/...`), which the page does not serve yet.
    resolveFn: () => undefined,
  });
  // Tinymist queues internal events while it handles a message; they must run before the reply goes out.
  const drained = <T>(result: T): T => {
    while (events.length > 0) for (const event of events.splice(0)) bridge.on_event(event);
    return result;
  };
  connection.onInitialize((params) => drained(bridge.on_request(InitializeRequest.method, params)));
  connection.onRequest((method, params) => drained(bridge.on_request(method, params)));
  connection.onNotification((method, params) => drained(bridge.on_notification(method, params)));
  void connection.sendNotification("serverWorkerReady");
  connection.listen();
}

startServer().catch((error: unknown) => console.error("Tinymist language server failed to start", error));
