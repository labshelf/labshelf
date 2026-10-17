// Mounts the LaTeX setup card: shows the helper's state, the one next action, and keeps looking while the helper is missing.
import type { ILogger } from "@labshelf/core";
import { confirmDialog, el, statusLine } from "@labshelf/core/dom";
import type { HelperProgressListener, ILatexHelper, TexInstallKind } from "@labshelf/core/helper";
import { MACOS_GUIDE_URL, helperDownloadUrl } from "./helperLinks";
import { createSetupProgress } from "./setupProgress";
import { startPolling, type Polling } from "./setupPolling";
import { INSTALL_ALL_LABEL, describeState, type SetupActions, type SetupState } from "./setupView";

export interface HelperSetupDeps {
  logger: ILogger;
  getPlatformInfo(): Promise<{ os: string }>;
  openUrl(url: string): void;
}

const TEX_LABEL: Record<TexInstallKind, string> = { tinytex: "TinyTeX", texlive: "TeX Live" };
const INSTALL_ALL_WARNING = "This downloads about 5 GB and installs the full TeX Live, so every project compiles without fetching packages. It can take a while.";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

interface Card {
  line: ReturnType<typeof statusLine>;
  controls: HTMLElement;
  os: string;
  disposed: boolean;
  polling: Polling | undefined;
  actions: SetupActions;
  polled: boolean;
}

function show(card: Card, helper: ILatexHelper, state: SetupState, extra?: Node): void {
  if (card.disposed) { return; }
  const view = describeState(state, card.os, card.actions);
  card.line.set(view.text, view.tone);
  card.controls.replaceChildren(...view.controls, ...(extra ? [extra] : []));
  const missing = state.kind === "status" && state.status.state === "not-installed";
  if (missing && !card.polling) { card.polling = startPolling(() => void poll(card, helper)); }
  if (!missing) { card.polling?.stop(); card.polling = undefined; }
}

async function connect(card: Card, helper: ILatexHelper, showChecking: boolean): Promise<void> {
  if (showChecking) { show(card, helper, { kind: "checking" }); }
  try {
    show(card, helper, { kind: "status", status: await helper.connect() });
  } catch (error) {
    show(card, helper, { kind: "error", message: messageOf(error) });
  }
}

// The missing-helper screen stays untouched until the helper appears, so a poll never moves the user's focus.
async function poll(card: Card, helper: ILatexHelper): Promise<void> {
  if (card.polled) { return; }
  card.polled = true;
  try {
    const status = await helper.connect();
    if (status.state !== "not-installed") { show(card, helper, { kind: "status", status }); }
  } catch (error) {
    show(card, helper, { kind: "error", message: messageOf(error) });
  } finally { card.polled = false; }
}

async function runInstall(card: Card, helper: ILatexHelper, logger: ILogger, action: string, label: string, run: (onProgress: HelperProgressListener) => Promise<void>): Promise<void> {
  const progress = createSetupProgress(label);
  show(card, helper, { kind: "installing", label }, progress.element);
  try {
    await run(progress.update);
    show(card, helper, { kind: "status", status: helper.status() ?? await helper.connect() });
  } catch (error) {
    await logger.error("helper-setup", error, { action });
    show(card, helper, { kind: "error", message: messageOf(error) });
  }
}

function createActions(card: () => Card, helper: ILatexHelper, deps: HelperSetupDeps): SetupActions {
  const install = (action: string, label: string, run: (onProgress: HelperProgressListener) => Promise<void>): Promise<void> =>
    runInstall(card(), helper, deps.logger, action, label, run);
  return {
    download: () => deps.openUrl(helperDownloadUrl(card().os)),
    openMacosGuide: () => deps.openUrl(MACOS_GUIDE_URL),
    retry: () => connect(card(), helper, true),
    install: (kind) => install(`install-${kind}`, `Installing ${TEX_LABEL[kind]}…`, (onProgress) => helper.installTex(kind, onProgress)),
    async installAllPackages() {
      if (!(await confirmDialog(INSTALL_ALL_LABEL.replace(" to compile offline", "?"), INSTALL_ALL_WARNING, "Download"))) { return; }
      await install("install-all-packages", "Installing TeX Live…", (onProgress) => helper.installAllPackages(onProgress));
    },
  };
}

export function mountHelperSetupCard(root: HTMLElement, helper: ILatexHelper, deps: HelperSetupDeps): { dispose(): void } {
  const line = statusLine();
  line.element.setAttribute("aria-live", "polite");
  const controls = el("div");
  root.replaceChildren(line.element, controls);
  const card: Card = { line, controls, os: "", disposed: false, polled: false, polling: undefined, actions: undefined as unknown as SetupActions };
  card.actions = createActions(() => card, helper, deps);

  void (async () => {
    show(card, helper, { kind: "checking" });
    try { card.os = (await deps.getPlatformInfo()).os; } catch (error) { await deps.logger.error("helper-setup", error, { action: "platform-info" }); }
    await connect(card, helper, false);
  })();

  return { dispose() { card.disposed = true; card.polling?.stop(); card.polling = undefined; } };
}
