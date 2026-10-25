/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The LaTeX setup card shows the helper's state with its one next action, polls while the helper is missing, and recovers from errors.
import type { TexInstallKind } from "@labshelf/core";
import type { HelperHost, HelperProgress, OnHelperProgress, HelperState, ILatexHelper, TexToolchain } from "@labshelf/core/helper";
import { mountHelperSetupCard, type HelperSetupDeps } from "../../../src/helper/setup";

const ready = (tex: TexToolchain, host: HelperHost = "helper"): HelperState => ({ state: "ready", helperVersion: "1.2.0", tex, host });
const ASSETS = "https://github.com/labshelf/labshelf/releases/latest/download/";

interface FakeHelper extends ILatexHelper {
  connect: jest.Mock<Promise<HelperState>, []>;
  installTex: jest.Mock<Promise<void>, [TexInstallKind, OnHelperProgress]>;
  installAllPackages: jest.Mock<Promise<void>, [OnHelperProgress]>;
}

function fakeHelper(first: HelperState | Error): FakeHelper {
  let current: HelperState | undefined;
  const connect = jest.fn(async () => {
    if (first instanceof Error) { throw first; }
    current = first;
    return first;
  });
  return {
    connect,
    status: () => current,
    compile: jest.fn(),
    cancel: jest.fn(),
    installTex: jest.fn(async () => { current = ready({ source: "tinytex", year: 2026, complete: false }); }),
    installAllPackages: jest.fn(async () => { current = ready({ source: "texlive", year: 2026, complete: true }); }),
  } as unknown as FakeHelper;
}

function setup(helper: ILatexHelper, os = "linux") {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const deps: HelperSetupDeps = {
    logger: { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) },
    getPlatformInfo: async () => ({ os }),
    openUrl: jest.fn(),
  };
  const card = mountHelperSetupCard(root, helper, deps);
  return { root, deps, card };
}

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) { await Promise.resolve(); } };
const buttons = (root: HTMLElement): string[] => [...root.querySelectorAll("button")].map((b) => b.textContent ?? "");
const button = (root: ParentNode, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!found) { throw new Error(`No button "${label}"`); }
  return found;
};
const installButtons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll("button")].filter((b) => b.textContent === "Install");
const setVisibility = (state: "visible" | "hidden"): void => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => { jest.useFakeTimers(); setVisibility("visible"); });
afterEach(() => { jest.useRealTimers(); });

describe("setup card states", () => {
  it("shows the checking state with no action until connect resolves", async () => {
    const helper = fakeHelper({ state: "not-installed" });
    const { root, card } = setup(helper);
    expect(root.textContent).toContain("Looking for LabShelf Helper");
    expect(root.querySelector("button")).toBeNull();
    await settle();
    card.dispose();
  });

  it("not installed: offers the download for the OS and a polite live status", async () => {
    const { root, deps, card } = setup(fakeHelper({ state: "not-installed" }), "win");
    await settle();
    expect(root.textContent).toContain("LabShelf Helper is not installed on this computer.");
    expect(root.querySelector("[aria-live=polite]")).not.toBeNull();
    button(root, "Download LabShelf Helper").click();
    expect(deps.openUrl).toHaveBeenCalledWith(`${ASSETS}labshelf-helper-windows-setup.exe`);
    card.dispose();
  });

  it.each([["mac", "labshelf-helper-macos.pkg"], ["win", "labshelf-helper-windows-setup.exe"], ["linux", "labshelf-helper-linux.deb"]])(
    "downloads the %s asset", async (os, asset) => {
      const { root, deps, card } = setup(fakeHelper({ state: "not-installed" }), os);
      await settle();
      button(root, "Download LabShelf Helper").click();
      expect(deps.openUrl).toHaveBeenCalledWith(`${ASSETS}${asset}`);
      card.dispose();
    });

  it("shows the macOS guide link only on macOS", async () => {
    const mac = setup(fakeHelper({ state: "not-installed" }), "mac");
    await settle();
    expect(buttons(mac.root)).toContain("How to open it on macOS");
    mac.card.dispose();
    const win = setup(fakeHelper({ state: "not-installed" }), "win");
    await settle();
    expect(buttons(win.root)).not.toContain("How to open it on macOS");
    win.card.dispose();
  });

  it("update-helper: names the installed version and offers the update download", async () => {
    const { root, deps, card } = setup(fakeHelper({ state: "update-helper", protocol: 0, host: "helper" }), "mac");
    await settle();
    expect(root.textContent).toContain("is older than this extension");
    button(root, "Download the update").click();
    expect(deps.openUrl).toHaveBeenCalledWith(`${ASSETS}labshelf-helper-macos.pkg`);
    card.dispose();
  });

  it("update-helper from a refused hello: asks to update the helper, or the app that runs it, and offers the download", async () => {
    const { root, deps, card } = setup(fakeHelper({ state: "update-helper", protocol: 2, host: undefined }), "mac");
    await settle();
    expect(root.textContent).toContain("Update LabShelf Helper: it is older than this extension.");
    expect(root.textContent).toContain("update that app instead");
    expect(root.textContent).not.toContain("version");
    button(root, "Download the update").click();
    expect(deps.openUrl).toHaveBeenCalledWith(`${ASSETS}labshelf-helper-macos.pkg`);
    card.dispose();
  });

  it.each([
    ["vscode", "LabShelf in VS Code is older than this extension. Update the LabShelf extension in VS Code and reload it."],
    ["terminal", "The LabShelf terminal app is older than this extension. Run npm install -g @labshelf/terminal to update it."],
  ] as const)("update-helper through %s: names that program and offers no download", async (host, text) => {
    const { root, card } = setup(fakeHelper({ state: "update-helper", protocol: 0, host }), "mac");
    await settle();
    expect(root.textContent).toContain(text);
    expect(buttons(root)).toEqual([]);
    card.dispose();
  });

  it("not installed: offers VS Code and the terminal app before any download, with the OS-specific sentence", async () => {
    const mac = setup(fakeHelper({ state: "not-installed" }), "mac");
    await settle();
    expect(mac.root.textContent).toContain("without installing an unsigned program.");
    expect(mac.root.textContent).toContain("In VS Code, run LabShelf: Build LaTeX for the Browser from the Command Palette.");
    expect([...mac.root.querySelectorAll("code")].map((c) => c.textContent)).toEqual(["labshelf helper install", "npm install -g @labshelf/terminal"]);
    expect(mac.root.textContent).toContain("Come back here.");
    mac.card.dispose();
    const win = setup(fakeHelper({ state: "not-installed" }), "win");
    await settle();
    expect(win.root.textContent).toContain("without installing another program.");
    expect(win.root.textContent).not.toContain("unsigned");
    win.card.dispose();
  });

  it.each([["helper", ""], ["vscode", " · through VS Code"], ["terminal", " · through the terminal app"]] as const)(
    "ready through %s: names the program only when it is not the helper", async (host, suffix) => {
      const { root, card } = setup(fakeHelper(ready({ source: "texlive", year: 2026, complete: true }, host)));
      await settle();
      expect(root.querySelector(".ls-status-line, [aria-live=polite]")?.textContent).toBe(`Ready: TeX Live 2026${suffix}`);
      card.dispose();
    });

  it("update-extension: asks for a newer extension and offers Check again", async () => {
    const helper = fakeHelper({ state: "update-extension", protocol: 9 });
    const { root, card } = setup(helper);
    await settle();
    expect(root.textContent).toContain("Update LabShelf: LabShelf Helper needs a newer version of the LabShelf extension.");
    button(root, "Check again").click();
    await settle();
    expect(helper.connect).toHaveBeenCalledTimes(2);
    card.dispose();
  });

  it("no TeX yet: offers Light first as primary and Full second", async () => {
    const { root, card } = setup(fakeHelper(ready({ source: "none", complete: false })));
    await settle();
    expect(root.textContent).toContain("Choose a TeX distribution to compile LaTeX.");
    expect(root.textContent).toContain("~100 MB");
    expect(root.textContent).toContain("~5 GB");
    const installs = installButtons(root);
    expect(installs).toHaveLength(2);
    expect(installs[0]!.classList.contains("ls-btn-primary")).toBe(true);
    expect(installs[1]!.classList.contains("ls-btn-primary")).toBe(false);
    card.dispose();
  });

  it("installing: shows a progressbar with the message, then ready", async () => {
    const helper = fakeHelper(ready({ source: "none", complete: false }));
    let report: OnHelperProgress = () => undefined;
    let finish: () => void = () => undefined;
    helper.installTex.mockImplementation((_kind, onProgress) => {
      report = onProgress;
      return new Promise<void>((resolve) => {
        finish = () => { helper.status = () => ready({ source: "tinytex", year: 2026, complete: false }); resolve(); };
      });
    });
    const { root, card } = setup(helper);
    await settle();
    installButtons(root)[0]!.click();
    await settle();
    expect(helper.installTex).toHaveBeenCalledWith("tinytex", expect.any(Function));
    expect(root.textContent).toContain("Installing TinyTeX…");
    const progress: HelperProgress = { phase: "installing-tex", message: "Downloading 40%", fraction: 0.4 };
    report(progress);
    const bar = root.querySelector("[role=progressbar]") as HTMLElement;
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-label")).toBeTruthy();
    expect(root.textContent).toContain("Downloading 40%");
    finish();
    await settle();
    expect(root.textContent).toContain("Ready: TinyTeX 2026");
    card.dispose();
  });

  it("choosing Full installs TeX Live", async () => {
    const helper = fakeHelper(ready({ source: "none", complete: false }));
    const { root, card } = setup(helper);
    await settle();
    installButtons(root)[1]!.click();
    await settle();
    expect(helper.installTex).toHaveBeenCalledWith("texlive", expect.any(Function));
    card.dispose();
  });

  it("ready with TinyTeX: offers all packages, behind a confirm that installs full TeX Live", async () => {
    const helper = fakeHelper(ready({ source: "tinytex", year: 2025, complete: false }));
    const { root, card } = setup(helper);
    await settle();
    expect(root.textContent).toContain("Ready: TinyTeX 2025");
    button(root, "Download all packages (~5 GB) to compile offline").click();
    await settle();
    const dialog = document.querySelector("[role=alertdialog]") as HTMLElement;
    expect(dialog.textContent).toContain("5 GB");
    expect(helper.installAllPackages).not.toHaveBeenCalled();
    button(dialog, "Download").click();
    await settle();
    expect(helper.installAllPackages).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain("Ready: TeX Live 2026");
    card.dispose();
  });

  it("cancelling the confirm installs nothing", async () => {
    const helper = fakeHelper(ready({ source: "tinytex", year: 2025, complete: false }));
    const { root, card } = setup(helper);
    await settle();
    button(root, "Download all packages (~5 GB) to compile offline").click();
    await settle();
    button(document.querySelector("[role=alertdialog]") as HTMLElement, "Cancel").click();
    await settle();
    expect(helper.installAllPackages).not.toHaveBeenCalled();
    card.dispose();
  });

  it("ready with TeX Live offers no extra download", async () => {
    const { root, card } = setup(fakeHelper(ready({ source: "texlive", year: 2026, complete: true })));
    await settle();
    expect(root.textContent).toContain("Ready: TeX Live 2026");
    expect(root.querySelector("button")).toBeNull();
    card.dispose();
  });
});

describe("setup card errors", () => {
  it("shows the message, and Try again reconnects", async () => {
    const helper = fakeHelper(new Error("Host crashed"));
    const { root, card } = setup(helper);
    await settle();
    expect(root.textContent).toContain("Host crashed");
    helper.connect.mockResolvedValueOnce(ready({ source: "texlive", year: 2026, complete: true }));
    button(root, "Try again").click();
    await settle();
    expect(root.textContent).toContain("Ready: TeX Live 2026");
    card.dispose();
  });

  it("an install failure goes to the error state and is logged", async () => {
    const helper = fakeHelper(ready({ source: "none", complete: false }));
    helper.installTex.mockRejectedValue(new Error("Disk full"));
    const { root, deps, card } = setup(helper);
    await settle();
    installButtons(root)[0]!.click();
    await settle();
    expect(root.textContent).toContain("Disk full");
    expect(deps.logger.error).toHaveBeenCalled();
    expect(buttons(root)).toContain("Try again");
    card.dispose();
  });
});

describe("setup card polling", () => {
  it("retries connect every 3 s while the helper is missing and the page is visible", async () => {
    const helper = fakeHelper({ state: "not-installed" });
    const { card } = setup(helper);
    await settle();
    expect(helper.connect).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(3000);
    expect(helper.connect).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(3000);
    expect(helper.connect).toHaveBeenCalledTimes(3);
    card.dispose();
  });

  it("pauses while the page is hidden and resumes when it is visible again", async () => {
    const helper = fakeHelper({ state: "not-installed" });
    const { card } = setup(helper);
    await settle();
    setVisibility("hidden");
    await jest.advanceTimersByTimeAsync(9000);
    expect(helper.connect).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await jest.advanceTimersByTimeAsync(3000);
    expect(helper.connect).toHaveBeenCalledTimes(2);
    card.dispose();
  });

  it("stops on dispose and once the helper is found", async () => {
    const helper = fakeHelper({ state: "not-installed" });
    const { root, card } = setup(helper);
    await settle();
    helper.connect.mockResolvedValueOnce(ready({ source: "texlive", year: 2026, complete: true }));
    await jest.advanceTimersByTimeAsync(3000);
    expect(root.textContent).toContain("Ready: TeX Live 2026");
    await jest.advanceTimersByTimeAsync(9000);
    expect(helper.connect).toHaveBeenCalledTimes(2);

    const other = fakeHelper({ state: "not-installed" });
    const second = setup(other);
    await settle();
    second.card.dispose();
    await jest.advanceTimersByTimeAsync(9000);
    expect(other.connect).toHaveBeenCalledTimes(1);
    card.dispose();
  });

  it("does not poll in other states", async () => {
    const helper = fakeHelper({ state: "update-helper", protocol: 0, host: "helper" });
    const { card } = setup(helper);
    await settle();
    await jest.advanceTimersByTimeAsync(9000);
    expect(helper.connect).toHaveBeenCalledTimes(1);
    card.dispose();
  });
});
