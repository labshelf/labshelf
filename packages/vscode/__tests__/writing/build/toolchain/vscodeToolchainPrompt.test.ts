// Tests the VS Code toolchain prompt: the first-run pick, the Tectonic download consent and progress, and the TeX Live fallback offer.
import * as vscode from "vscode";

import { vscodeToolchainPrompt } from "../../../../src/writing/build/toolchain";

const window = vscode.window as unknown as Record<string, jest.Mock>;
const asset = { sizeMb: 12 } as never;

beforeEach(() => {
  jest.resetAllMocks();
  window["withProgress"]!.mockImplementation(async (_options, task) =>
    task({ report: jest.fn() }, { isCancellationRequested: false, onCancellationRequested: jest.fn() }));
});

describe("pickEngine", () => {
  it("lists TeX Live first when it is installed and returns the picked engine", async () => {
    window["showQuickPick"]!.mockImplementation(async (items) => items[0]);

    const engine = await vscodeToolchainPrompt.pickEngine({ texLiveInstalled: true, tectonic: asset });

    const items = window["showQuickPick"]!.mock.calls[0]![0];
    expect(items.map((item: { label: string }) => item.label)).toEqual(["TeX Live (latexmk)", "XeLaTeX (Tectonic)"]);
    expect(items[1].description).toBe("recommended");
    expect(items[1].detail).toMatch(/Downloads about 12 MB once/);
    expect(engine).toBe("pdflatex");
  });

  it("lists Tectonic first and says TeX Live is missing; Escape picks nothing", async () => {
    window["showQuickPick"]!.mockResolvedValue(undefined);

    expect(await vscodeToolchainPrompt.pickEngine({ texLiveInstalled: false, tectonic: undefined })).toBeUndefined();

    const items = window["showQuickPick"]!.mock.calls[0]![0];
    expect(items[0].label).toBe("XeLaTeX (Tectonic)");
    expect(items[0].detail).toBe("Not available on this system.");
    expect(items[1].detail).toBe("TeX Live is not installed.");
  });
});

describe("confirmTectonicDownload", () => {
  it("names version, size and GitHub in a modal and is true only on Download", async () => {
    window["showInformationMessage"]!.mockResolvedValue("Download");

    expect(await vscodeToolchainPrompt.confirmTectonicDownload(asset)).toBe(true);

    const [message, options] = window["showInformationMessage"]!.mock.calls[0]!;
    expect(message).toMatch(/Tectonic 0\.17\.0 \(about 12 MB\)/);
    expect(options).toMatchObject({ modal: true, detail: expect.stringContaining("GitHub") });
  });

  it("is false when the user dismisses the modal", async () => {
    window["showInformationMessage"]!.mockResolvedValue(undefined);
    expect(await vscodeToolchainPrompt.confirmTectonicDownload(asset)).toBe(false);
  });
});

describe("downloading", () => {
  it("returns the result of the run", async () => {
    expect(await vscodeToolchainPrompt.downloading(async () => "/storage/tectonic")).toBe("/storage/tectonic");
  });

  it("aborts the run's signal when the notification is cancelled", async () => {
    window["withProgress"]!.mockImplementation(async (_options, task) => {
      let cancel = () => {};
      const pending = task({ report: jest.fn() }, { onCancellationRequested: (listener: () => void) => { cancel = listener; } });
      cancel();
      return pending;
    });
    let received: AbortSignal | undefined;

    await vscodeToolchainPrompt.downloading(async (signal) => { received = signal; });

    expect(received?.aborted).toBe(true);
  });
});

describe("offerTectonic", () => {
  it("explains that pdfLaTeX needs TeX Live", async () => {
    window["showErrorMessage"]!.mockResolvedValue(undefined);

    expect(await vscodeToolchainPrompt.offerTectonic("pdflatex")).toBe(false);
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(
      "pdfLaTeX needs TeX Live, which is not installed. Tectonic runs only XeLaTeX.", "Open install guide", "Use Tectonic",
    );
  });

  it("opens the install guide and declines", async () => {
    window["showErrorMessage"]!.mockResolvedValue("Open install guide");

    expect(await vscodeToolchainPrompt.offerTectonic("xelatex")).toBe(false);
    expect(vscode.env.openExternal).toHaveBeenCalledWith(expect.objectContaining({ scheme: "https" }));
  });

  it("accepts Tectonic on Use Tectonic", async () => {
    window["showErrorMessage"]!.mockResolvedValue("Use Tectonic");
    expect(await vscodeToolchainPrompt.offerTectonic("lualatex")).toBe(true);
  });
});
