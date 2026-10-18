// Registers the web extensions the build bundles next to the page (LabShelf and Tinymist) with the worker extension host.
import { ExtensionHostKind, registerExtension } from "@codingame/monaco-vscode-api/extensions";
import type { IExtensionManifest } from "@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions";

/** Folders under editor/extensions/, each with the extension's files and a files.json listing them. */
const BUNDLED = ["labshelf", "tinymist"] as const;

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Loading ${url.pathname} failed with ${response.status}`);
  return (await response.json()) as T;
}

const folderUrl = (id: string): URL => new URL(`extensions/${id}/`, location.href);

async function registerBundled(id: string): Promise<void> {
  const base = folderUrl(id);
  const [manifest, files] = await Promise.all([
    fetchJson<IExtensionManifest>(new URL("package.json", base)),
    fetchJson<string[]>(new URL("files.json", base)),
  ]);
  const extension = registerExtension(manifest, ExtensionHostKind.LocalWebWorker, { path: `/${id}` });
  for (const file of files) extension.registerFileUrl(file, new URL(file, base).toString());
  await extension.whenReady();
}

/** Resolves once both extensions are registered and their host is ready; activation follows their activation events. */
export async function registerBundledExtensions(): Promise<void> {
  await Promise.all(BUNDLED.map(registerBundled));
}
