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

function notInstalled(isMac: boolean, actions: SetupActions): SetupView {
  const controls: Node[] = [download("Download LabShelf Helper", actions)];
  if (isMac) { controls.push(actionButton({ label: "How to open it on macOS", icon: "external", onClick: actions.openMacosGuide })); }
  controls.push(el("p", { class: "setting-desc", text: "This section updates when the helper starts." }));
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
