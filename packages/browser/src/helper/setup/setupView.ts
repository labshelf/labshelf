// Describes each helper setup state as a status line and its controls; the card applies it and runs the actions.
import { actionButton, el, settingRow, type StatusTone } from "@labshelf/core/dom";
import type { HelperStatus, TexInstallKind, TexStatus } from "@labshelf/core/helper";

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

function installSteps(isMac: boolean): HTMLElement {
  const steps = [
    "Download LabShelf Helper and run the installer.",
    isMac ? "Open it once. macOS asks you to confirm an app from the internet; the guide below shows how." : undefined,
    "Come back here. This section notices the helper on its own and offers to install TeX if this computer has none.",
  ];
  return el("ol", { class: "setting-desc" }, ...steps.map((step) => step && el("li", { text: step })));
}

function notInstalled(isMac: boolean, actions: SetupActions): SetupView {
  const controls: Node[] = [el("p", { class: "setting-desc", text: WHAT_IT_IS }), installSteps(isMac), download("Download LabShelf Helper", actions)];
  if (isMac) { controls.push(actionButton({ label: "How to open it on macOS", icon: "external", onClick: actions.openMacosGuide })); }
  return { text: "LabShelf Helper is not installed on this computer.", tone: "idle", controls };
}

function chooseTex(actions: SetupActions): SetupView {
  const rows = INSTALL_CHOICES.map((choice, index) => settingRow(
    { label: choice.label, description: choice.description },
    actionButton({ label: "Install", icon: "download", primary: index === 0, onClick: () => actions.install(choice.kind) }),
  ));
  return { text: "Choose a TeX distribution to compile LaTeX.", tone: "idle", controls: rows };
}

function readyView(tex: TexStatus, actions: SetupActions): SetupView {
  const name = [TEX_NAME[tex.source], tex.year].filter((part) => part !== undefined && part !== "").join(" ");
  const controls = tex.source === "tinytex" && !tex.complete
    ? [actionButton({ label: INSTALL_ALL_LABEL, icon: "download", onClick: actions.installAllPackages })]
    : [];
  return { text: `Ready: ${name}`, tone: "ok", controls };
}

function statusView(status: HelperStatus, isMac: boolean, actions: SetupActions): SetupView {
  switch (status.state) {
    case "not-installed": return notInstalled(isMac, actions);
    case "update-helper":
      return { text: "LabShelf Helper is older than this extension.", tone: "idle", controls: [download("Download the update", actions)] };
    case "update-extension":
      return { text: "LabShelf Helper needs a newer version of the LabShelf extension.", tone: "idle", controls: [retry("Check again", actions)] };
    case "ready": return status.tex.source === "none" ? chooseTex(actions) : readyView(status.tex, actions);
  }
}

export function describeState(state: SetupState, os: string, actions: SetupActions): SetupView {
  switch (state.kind) {
    case "checking": return { text: "Looking for LabShelf Helper…", tone: "idle", controls: [] };
    case "installing": return { text: state.label, tone: "idle", controls: [] };
    case "error": return { text: state.message, tone: "error", controls: [retry("Try again", actions)] };
    case "status": return statusView(state.status, os === "mac", actions);
  }
}
