// Tests the VS Code toolchain prompt: the install choice and the install progress notification.
import * as vscode from "vscode";

import { vscodeToolchainPrompt } from "../../../../src/writing/build/toolchain";

const window = vscode.window as unknown as Record<string, jest.Mock>;

beforeEach(() => jest.resetAllMocks());

describe("chooseInstall", () => {
  it("asks in a modal and maps Light to TinyTeX and Full to TeX Live", async () => {
    window["showInformationMessage"]!.mockResolvedValueOnce("Install Light").mockResolvedValueOnce("Install Full");

    expect(await vscodeToolchainPrompt().chooseInstall()).toBe("tinytex");
    expect(await vscodeToolchainPrompt().chooseInstall()).toBe("texlive");

    const [message, options, ...buttons] = window["showInformationMessage"]!.mock.calls[0]!;
    expect(message).toMatch(/LaTeX is not installed/);
    expect(options).toMatchObject({ modal: true });
    expect(buttons).toEqual(["Install Light", "Install Full"]);
  });

  it("declines when the modal is dismissed", async () => {
    window["showInformationMessage"]!.mockResolvedValue(undefined);
    expect(await vscodeToolchainPrompt().chooseInstall()).toBeUndefined();
  });
});

describe("progress", () => {
  it("shows a notification titled after the work and forwards its messages", async () => {
    const report = jest.fn();
    window["withProgress"]!.mockImplementation(async (_options, task) => task({ report }));

    const result = await vscodeToolchainPrompt().progress("Installing TinyTeX", async (say) => { say("40%"); return "done"; });

    expect(result).toBe("done");
    expect(window["withProgress"]).toHaveBeenCalledWith(expect.objectContaining({ title: "Installing TinyTeX", cancellable: false }), expect.any(Function));
    expect(report).toHaveBeenCalledWith({ message: "40%" });
  });
});
