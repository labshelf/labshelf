/**
 * Gives a webview's content document what VS Code's inline bootstrap script gives it, from a file the extension CSP allows:
 * acquireVsCodeApi, and fetch of webview resources (entry of editor/webview/vscodeApi.js, which the webview host injects).
 */
import { webviewResource, type HostResourceRequest } from "./webviewResource";

interface WebviewHostWindow extends Window {
  __vscode_post_message__(channel: string, data: unknown, transfer?: Transferable[]): void;
  __labshelf_load_resource__(request: HostResourceRequest): Promise<HostResourceResponse>;
}

/** What the workbench host's `did-load-resource` message carries; a 200 comes with a transferable stream. */
interface HostResourceResponse {
  status: number;
  mime?: string;
  stream?: ReadableStream<Uint8Array>;
}

// TRAP: the Response is built here, not in the host page, so its ArrayBuffer belongs to this realm; pdf.js rejects a foreign one.
async function hostResponse(request: HostResourceRequest): Promise<Response> {
  const { status, mime, stream } = await host.__labshelf_load_resource__(request);
  return new Response(stream ?? null, { status, headers: mime ? { "Content-Type": mime } : {} });
}

const script = document.currentScript as HTMLScriptElement;
// INVARIANT: the content document is written into the host's fake.html, so both sit in editor/webview/ on the page's origin.
const extensionsBase = new URL("../extensions/", location.href).href;
const host = window.parent as WebviewHostWindow;
const post = host.__vscode_post_message__.bind(host);
const allowMultiple = script.dataset.allowMultiple === "true";
let state: unknown = script.dataset.state ? JSON.parse(script.dataset.state) : undefined;
let acquired = false;

(globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => {
  if (acquired && !allowMultiple) throw new Error("An instance of the VS Code API has already been acquired");
  acquired = true;
  return Object.freeze({
    postMessage: (message: unknown, transfer?: Transferable[]) => post("onmessage", { message, transfer }, transfer),
    setState: (next: unknown) => { state = next; post("do-update-state", JSON.stringify(next)); return next; },
    getState: () => state,
  });
};

// PLATFORM: VS Code serves webview resources through a service worker, which an extension page cannot register.
const pageFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const resource = webviewResource(url, extensionsBase);
  if (!resource) return pageFetch(input, init);
  return resource.kind === "page" ? pageFetch(resource.url, init) : hostResponse(resource.request);
};

// The isolation VS Code's bootstrap applies; it also assigns top and frameElement, which browsers ignore and strict code may not assign.
(window as { parent: Window }).parent = window;
