/**
 * Writes the editor page's webview host into editor/webview/: VS Code's webview host page with its inline script moved to a
 * file, and exact-text patches so it runs under the extension CSP without the service worker an extension page cannot register.
 */
import { copyFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PRE = "service-override/viewCommon/vs/workbench/contrib/webview/browser/pre";

// CONTRACT: src/editor/webview/webviewResource.ts maps the same URLs inside fetch; both follow VS Code's asWebviewUri.
const RESOURCE_HELPERS = `const labshelfExtensionsBase = new URL('../extensions/', location.href).href;
const labshelfExtensionUrls = (html) => html.replace(/https:\\/\\/extension-file(?:\\+|%2B)[^./"'\\s]*\\.vscode-resource\\.vscode-cdn\\.net\\//gi, labshelfExtensionsBase);
const labshelfResources = new Map();
let labshelfResourceId = 0;
let labshelfResourcesHeard = false;
window.__labshelf_load_resource__ = (request) => {
	if (!labshelfResourcesHeard) {
		labshelfResourcesHeard = true;
		hostMessaging.onMessage('did-load-resource', (_event, data) => {
			const settle = labshelfResources.get(data.id);
			labshelfResources.delete(data.id);
			settle?.(data);
		});
	}
	const id = ++labshelfResourceId;
	return new Promise((resolve) => {
		labshelfResources.set(id, resolve);
		hostMessaging.postMessage('load-resource', { ...request, id });
	});
};
`;

/** Each patch must find its text, so an upgrade of the pinned version fails the build instead of shipping unpatched. */
const PATCHES = [
  {
    // Resources come through fetch in the content (vscodeApi.js) and the host messages, not a service worker.
    from: "const disableServiceWorker = searchParams.has('disableServiceWorker');",
    to: `const disableServiceWorker = true;\n${RESOURCE_HELPERS}`,
  },
  {
    // The inline bootstrap breaks the extension CSP; the same API loads from a file, with its inputs on the element.
    from: "defaultScript.textContent = getVsCodeApiScript(options.allowMultipleAPIAcquire, data.state);",
    to: "defaultScript.src = new URL('vscodeApi.js', location.href).href; defaultScript.dataset.state = data.state ?? ''; defaultScript.dataset.allowMultiple = String(!!options.allowMultipleAPIAcquire);",
  },
  {
    // The rewritten extension URLs and vscodeApi.js are on the page's origin, which the content's own CSP must allow.
    from: "csp.setAttribute('content', newCsp);",
    to: "csp.setAttribute('content', newCsp.split(data.cspSource).join(`'self' ${data.cspSource}`));",
  },
  {
    // Extension scripts must load from the page's origin, the only one the extension CSP allows.
    from: "return '<!DOCTYPE html>\\n' + newDocument.documentElement.outerHTML;",
    to: "return '<!DOCTYPE html>\\n' + labshelfExtensionUrls(newDocument.documentElement.outerHTML);",
  },
];

async function preFolder(pkgRoot) {
  // view-common is a dependency of the workbench override, so it sits beside the override's real folder.
  const workbench = await realpath(join(pkgRoot, "node_modules/@codingame/monaco-vscode-workbench-service-override"));
  return join(workbench, "../monaco-vscode-view-common-service-override", PRE);
}

export async function writeWebviewHost({ pkgRoot, editorDir }) {
  const pre = await preFolder(pkgRoot);
  const outDir = join(editorDir, "webview");
  await mkdir(outDir, { recursive: true });
  const html = await readFile(join(pre, "index.html"), "utf8");
  const inline = html.match(/<script async type="module">([\s\S]*)<\/script>/);
  if (!inline) throw new Error("No inline script in the webview host page");
  let script = inline[1];
  for (const { from, to } of PATCHES) {
    if (!script.includes(from)) throw new Error(`Webview host patch target missing: ${from}`);
    script = script.replace(from, to);
  }
  await writeFile(join(outDir, "index.js"), script);
  await writeFile(join(outDir, "index.html"), html.replace(inline[0], '<script type="module" src="index.js"></script>'));
  await copyFile(join(pre, "fake.html"), join(outDir, "fake.html"));
}
