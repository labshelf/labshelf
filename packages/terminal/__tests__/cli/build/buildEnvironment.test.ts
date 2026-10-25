// Tests the terminal's LaTeX install question: the answer mapping and the decline without a terminal.
import { createTerminalTexSetupAsk } from "../../../src/cli/build/buildEnvironment";

const answering = (answer: string | undefined) => createTerminalTexSetupAsk(async () => answer);

describe("terminalTexSetupPrompt.chooseInstall", () => {
  it.each([["l", "tinytex"], ["Light", "tinytex"], ["f", "texlive"], ["FULL", "texlive"]])("maps %s to %s", async (answer, kind) => {
    expect(await answering(answer).chooseInstall()).toBe(kind);
  });

  it.each(["", "n", "x", undefined])("declines on %s", async (answer) => {
    expect(await answering(answer).chooseInstall()).toBeUndefined();
  });

  it("declines without a terminal", async () => {
    expect(await createTerminalTexSetupAsk(undefined).chooseInstall()).toBeUndefined();
  });
});
