// Mounts the LaTeX setup card: shows the helper's state, the one next action, and keeps looking while the helper is missing.
import type { ILogger, TexInstallKind } from "@labshelf/core";
import {
  askDialog,
  renderElement,
  createToneLine,
  renderActionButton,
  renderSettingRow,
  type ToneLineTone,
} from "@labshelf/core/dom";
import type {
  HelperProgressListener,
  ILatexHelper,
  HelperProgress,
  HelperHost,
  HelperState,
  TexToolchain,
} from "@labshelf/core/helper";
import { MACOS_GUIDE_URL, helperDownloadUrl } from "./helperInstaller";

const LOOK_BACK_NOTE = "Come back here. This section notices the helper on its own and offers to install TeX if this computer has none.";

function installSteps(isMac: boolean): HTMLElement {
  const steps = [
    "Download LabShelf Helper and run the installer.",
    isMac ? "Open it once. macOS asks you to confirm an app from the internet; the guide below shows how." : undefined,
  ];
  return renderElement("ol", { class: "setting-desc" }, ...steps.map((step) => step && renderElement("li", { text: step })));
}

// The Windows helper is signed; the macOS and Linux builds are not, which is why the desktop apps come first there.
function desktopAlternatives(os: string): HTMLElement[] {
  const without = os === "win" ? "installing another program" : "installing an unsigned program";
  return [
    renderElement("p", {
      class: "setting-desc",
      text: `Already use LabShelf in VS Code or the terminal? Either one builds LaTeX for the browser without ${without}.`,
    }),
    renderElement("ul", { class: "setting-desc" },
      renderElement("li", { text: "In VS Code, run LabShelf: Build LaTeX for the Browser from the Command Palette." }),
      renderElement("li", {}, "In a terminal, run ", renderElement("code", { text: "labshelf helper install" }), ". To get the terminal app, run ", renderElement("code", { text: "npm install -g @labshelf/terminal" }), "."),
    ),
  ];
}

type SetupState =
  | { kind: "checking" }
  | { kind: "status"; status: HelperState }
  | { kind: "installing"; label: string }
  | { kind: "error"; message: string };

interface SetupActions {
  download(): void;
  openMacosGuide(): void;
  retry(): Promise<void>;
  install(kind: TexInstallKind): Promise<void>;
  installAllPackages(): Promise<void>;
}

interface SetupView {
  text: string;
  tone: ToneLineTone;
  controls: Node[];
}

const TEX_NAME: Record<TexToolchain["source"], string> = { none: "", tinytex: "TinyTeX", texlive: "TeX Live", system: "System TeX" };
const INSTALL_CHOICES: Array<{ kind: TexInstallKind; label: string; description: string }> = [
  { kind: "tinytex", label: "Light: TinyTeX, ~100 MB", description: "Installs packages when a project needs them." },
  { kind: "texlive", label: "Full: TeX Live, ~5 GB", description: "Every package, works offline." },
];

const INSTALL_ALL_LABEL = "Download all packages (~5 GB) to compile offline";

const download = (label: string, actions: SetupActions): HTMLButtonElement =>
  renderActionButton({ label, icon: "download", primary: true, onClick: actions.download });

const retry = (label: string, actions: SetupActions): HTMLButtonElement =>
  renderActionButton({ label, icon: "refresh", primary: true, onClick: actions.retry });

const WHAT_IT_IS = "LabShelf Helper is a small program that runs on your computer. A browser cannot run TeX, so LabShelf sends your "
  + "LaTeX project to the helper, which compiles it with a TeX distribution on this computer and sends back the PDF. Your files "
  + "never leave this computer. Typst projects compile in the page and do not need it.";

function notInstalled(os: string, actions: SetupActions): SetupView {
  const isMac = os === "mac";
  const controls: Node[] = [renderElement("p", { class: "setting-desc", text: WHAT_IT_IS }), installSteps(isMac), download("Download LabShelf Helper", actions)];
  if (isMac) { controls.push(renderActionButton({ label: "How to open it on macOS", icon: "external", onClick: actions.openMacosGuide })); }
  controls.push(...desktopAlternatives(os), renderElement("p", { class: "setting-desc", text: LOOK_BACK_NOTE }));
  return { text: "LabShelf Helper is not installed on this computer.", tone: "idle", controls };
}

function chooseTex(actions: SetupActions): SetupView {
  const rows = INSTALL_CHOICES.map((choice, index) => renderSettingRow(
    { label: choice.label, description: choice.description },
    renderActionButton({ label: "Install", icon: "download", primary: index === 0, onClick: () => actions.install(choice.kind) }),
  ));
  return { text: "Choose a TeX distribution to compile LaTeX.", tone: "idle", controls: rows };
}

const HOST_SUFFIX: Record<HelperHost, string> = { helper: "", vscode: " · through VS Code", terminal: " · through the terminal app" };

function readyView(tex: TexToolchain, host: HelperHost, actions: SetupActions): SetupView {
  const name = [TEX_NAME[tex.source], tex.year].filter((part) => part !== undefined && part !== "").join(" ");
  const controls = tex.source === "tinytex" && !tex.complete
    ? [renderActionButton({ label: INSTALL_ALL_LABEL, icon: "download", onClick: actions.installAllPackages })]
    : [];
  return { text: `Ready: ${name}${HOST_SUFFIX[host]}`, tone: "ok", controls };
}

const OLDER_BY_HOST: Record<Exclude<HelperHost, "helper">, string> = {
  vscode: "LabShelf in VS Code is older than this extension. Update the LabShelf extension in VS Code and reload it.",
  terminal: "The LabShelf terminal app is older than this extension. Run npm install -g @labshelf/terminal to update it.",
};

const OLDER_HELPER_TEXT = "Update LabShelf Helper: it is older than this extension.";
const OLDER_UNKNOWN_HOST_TEXT = `${OLDER_HELPER_TEXT} If LabShelf runs through VS Code or the terminal app, update that app instead.`;

function updateHelper(host: HelperHost | undefined, actions: SetupActions): SetupView {
  if (host === undefined) { return { text: OLDER_UNKNOWN_HOST_TEXT, tone: "idle", controls: [download("Download the update", actions)] }; }
  if (host === "helper") { return { text: OLDER_HELPER_TEXT, tone: "idle", controls: [download("Download the update", actions)] }; }
  return { text: OLDER_BY_HOST[host], tone: "idle", controls: [] };
}

function statusView(status: HelperState, os: string, actions: SetupActions): SetupView {
  switch (status.state) {
    case "not-installed": return notInstalled(os, actions);
    case "update-helper": return updateHelper(status.host, actions);
    case "update-extension":
      return { text: "Update LabShelf: LabShelf Helper needs a newer version of the LabShelf extension.", tone: "idle", controls: [retry("Check again", actions)] };
    case "ready": return status.tex.source === "none" ? chooseTex(actions) : readyView(status.tex, status.host, actions);
  }
}

function describeState(state: SetupState, os: string, actions: SetupActions): SetupView {
  switch (state.kind) {
    case "checking": return { text: "Looking for LabShelf Helper…", tone: "idle", controls: [] };
    case "installing": return { text: state.label, tone: "idle", controls: [] };
    case "error": return { text: state.message, tone: "error", controls: [retry("Try again", actions)] };
    case "status": return statusView(state.status, os, actions);
  }
}

interface SetupProgress {
  element: HTMLElement;
  update(progress: HelperProgress): void;
}

function createSetupProgress(label: string): SetupProgress {
  const bar = renderElement("div", { class: "helper-progress-bar indeterminate" });
  const track = renderElement("div", { class: "helper-progress-track", role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100 }, bar);
  const message = renderElement("div", { class: "helper-progress-message" });
  return {
    element: renderElement("div", { class: "helper-progress" }, track, message),
    update({ fraction, message: text }) {
      message.textContent = text;
      // An absent fraction is an indeterminate wait, so the bar carries no aria-valuenow.
      const percent = fraction === undefined ? undefined : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      bar.classList.toggle("indeterminate", percent === undefined);
      bar.style.width = percent === undefined ? "" : `${percent}%`;
      if (percent === undefined) { track.removeAttribute("aria-valuenow"); } else { track.setAttribute("aria-valuenow", String(percent)); }
    },
  };
}

const POLL_INTERVAL_MS = 3000;

interface Polling { stop(): void }

function startPolling(tick: () => void): Polling {
  let timer: ReturnType<typeof setInterval> | undefined;
  const sync = (): void => {
    const visible = document.visibilityState === "visible";
    if (visible && timer === undefined) { timer = setInterval(tick, POLL_INTERVAL_MS); }
    if (!visible && timer !== undefined) { clearInterval(timer); timer = undefined; }
  };
  document.addEventListener("visibilitychange", sync);
  sync();
  return {
    stop() {
      document.removeEventListener("visibilitychange", sync);
      if (timer !== undefined) { clearInterval(timer); timer = undefined; }
    },
  };
}

export interface HelperSetupDeps {
  logger: ILogger;
  getPlatformInfo(): Promise<{ os: string }>;
  openUrl(url: string): void;
}

const TEX_LABEL: Record<TexInstallKind, string> = { tinytex: "TinyTeX", texlive: "TeX Live" };
const INSTALL_ALL_WARNING = "This downloads about 5 GB and installs the full TeX Live, so every project compiles without fetching packages. It can take a while.";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

interface Card {
  line: ReturnType<typeof createToneLine>;
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
      if (!(await askDialog(INSTALL_ALL_LABEL.replace(" to compile offline", "?"), INSTALL_ALL_WARNING, "Download"))) { return; }
      await install("install-all-packages", "Installing TeX Live…", (onProgress) => helper.installAllPackages(onProgress));
    },
  };
}

export function mountHelperSetupCard(root: HTMLElement, helper: ILatexHelper, deps: HelperSetupDeps): { dispose(): void } {
  const line = createToneLine();
  line.element.setAttribute("aria-live", "polite");
  const controls = renderElement("div");
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
