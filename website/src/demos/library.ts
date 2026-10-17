// Mounts the shared library UI over the demo library, answered by an in-page host that keeps every edit in memory.
import { createLoopbackTransport, DEFAULT_PREFS } from "@labshelf/core";
import { mountLibraryUi } from "@labshelf/core/dom";

import { addScopedStyles, attachDemoHost, createDemoLibrary, type DemoData } from "./library/index.js";
import { consoleLogger } from "./log/index.js";

async function loadData(): Promise<DemoData> {
  const url = new URL("./library-data.json", import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Demo library: ${url.pathname} answered ${res.status}`);
  return (await res.json()) as DemoData;
}

async function mount(container: HTMLElement): Promise<void> {
  addScopedStyles();
  const { ui, host } = createLoopbackTransport();
  // The host listens before the UI mounts, so the UI's ready message finds it.
  attachDemoHost(host, createDemoLibrary(await loadData()), consoleLogger);
  mountLibraryUi(container, {
    transport: ui,
    // Prefs reset on reload with the rest of the demo.
    prefs: { load: () => ({ ...DEFAULT_PREFS, includeSub: true }), save: () => undefined },
    capabilities: {},
    labels: { addTooltip: "Add a paper", emptyHint: "Papers come in from the browser extension or the VS Code Add button." },
  });
}

const container = document.querySelector<HTMLElement>('[data-demo="library"]');
if (container) mount(container).catch((err: unknown) => { void consoleLogger.error("website-demo", err); });
