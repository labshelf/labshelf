// Describes each helper setup state as a status line and its controls; the card applies it and runs the actions.
import { actionButton, el, settingRow, type StatusTone } from "@labshelf/core/dom";
import type { TexInstallKind } from "@labshelf/core";
import type { HelperHost, HelperStatus, TexStatus } from "@labshelf/core/helper";
import { desktopAlternatives, installSteps, LOOK_BACK_NOTE } from "./installCard";

export type SetupState =
  | { kind: "checking" }
  | { kind: "status"; status: HelperStatus }
  | { kind: "installing"; label: string }
  | { kind: "error"; message: string };

export interface SetupActions {
  download(): void;
  openMacosGuide(): void;
  retry(): Promise<void>;
  install(kind: TexInstallKind): Promise<void>;
  installAllPackages(): Promise<void>;
}

export interface SetupView {
  text: string;
  tone: StatusTone;
  controls: Node[];
}

const TEX_NAME: Record<TexStatus["source"], string> = { none: "", tinytex: "TinyTeX", texlive: "TeX Live", system: "System TeX" };
const INSTALL_CHOICES: Array<{ kind: TexInstallKind; label: string; description: string }> = [
  { kind: "tinytex", label: "Light: TinyTeX, ~100 MB", description: "Installs packages when a project needs them." },
  { kind: "texlive", label: "Full: TeX Live, ~5 GB", description: "Every package, works offline." },
];

export const INSTALL_ALL_LABEL = "Download all packages (~5 GB) to compile offline";

const download = (label: string, actions: SetupActions): HTMLButtonElement =>
  actionButton({ label, icon: "download", primary: true, onClick: actions.download });

const retry = (label: string, actions: SetupActions): HTMLButtonElement =>
  actionButton({ label, icon: "refresh", primary: true, onClick: actions.retry });

const WHAT_IT_IS = "LabShelf Helper is a small program that runs on your computer. A browser cannot run TeX, so LabShelf sends your "
  + "LaTeX project to the helper, which compiles it with a TeX distribution on this computer and sends back the PDF. Your files "
  + "never leave this computer. Typst projects compile in the page and do not need it.";

function notInstalled(os: string, actions: SetupActions): SetupView {
  const isMac = os === "mac";
  const controls: Node[] = [el("p", { class: "setting-desc", text: WHAT_IT_IS }), installSteps(isMac), download("Download LabShelf Helper", actions)];
  if (isMac) { controls.push(actionButton({ label: "How to open it on macOS", icon: "external", onClick: actions.openMacosGuide })); }
  controls.push(...desktopAlternatives(os), el("p", { class: "setting-desc", text: LOOK_BACK_NOTE }));
  return { text: "LabShelf Helper is not installed on this computer.", tone: "idle", controls };
}

function chooseTex(actions: SetupActions): SetupView {
  const rows = INSTALL_CHOICES.map((choice, index) => settingRow(
    { label: choice.label, description: choice.description },
    actionButton({ label: "Install", icon: "download", primary: index === 0, onClick: () => actions.install(choice.kind) }),
  ));
  return { text: "Choose a TeX distribution to compile LaTeX.", tone: "idle", controls: rows };
}

const HOST_SUFFIX: Record<HelperHost, string> = { helper: "", vscode: " · through VS Code", terminal: " · through the terminal app" };

function readyView(tex: TexStatus, host: HelperHost, actions: SetupActions): SetupView {
  const name = [TEX_NAME[tex.source], tex.year].filter((part) => part !== undefined && part !== "").join(" ");
  const controls = tex.source === "tinytex" && !tex.complete
    ? [actionButton({ label: INSTALL_ALL_LABEL, icon: "download", onClick: actions.installAllPackages })]
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

function statusView(status: HelperStatus, os: string, actions: SetupActions): SetupView {
  switch (status.state) {
    case "not-installed": return notInstalled(os, actions);
    case "update-helper": return updateHelper(status.host, actions);
    case "update-extension":
      return { text: "Update LabShelf: LabShelf Helper needs a newer version of the LabShelf extension.", tone: "idle", controls: [retry("Check again", actions)] };
    case "ready": return status.tex.source === "none" ? chooseTex(actions) : readyView(status.tex, status.host, actions);
  }
}

export function describeState(state: SetupState, os: string, actions: SetupActions): SetupView {
  switch (state.kind) {
    case "checking": return { text: "Looking for LabShelf Helper…", tone: "idle", controls: [] };
    case "installing": return { text: state.label, tone: "idle", controls: [] };
    case "error": return { text: state.message, tone: "error", controls: [retry("Try again", actions)] };
    case "status": return statusView(state.status, os, actions);
  }
}
