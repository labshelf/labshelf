import { helperToolchainPrompt } from "../../../../src/helper/build/toolchain/helperToolchainPrompt";

const TECTONIC = { version: "1", url: "u", sha256: "s", file: "f" } as never;

describe("helperToolchainPrompt", () => {
  it("picks the engine it was given, whatever is installed", async () => {
    const prompt = helperToolchainPrompt("lualatex");
    expect(await prompt.pickEngine({ texLiveInstalled: false, tectonic: TECTONIC })).toBe("lualatex");
    expect(await prompt.pickEngine({ texLiveInstalled: true, tectonic: undefined })).toBe("lualatex");
  });

  it("never offers or downloads Tectonic", async () => {
    const prompt = helperToolchainPrompt("pdflatex");
    expect(await prompt.offerTectonic("pdflatex")).toBe(false);
    expect(await prompt.confirmTectonicDownload(TECTONIC)).toBe(false);
    await expect(prompt.downloading(async () => "x")).rejects.toThrow();
  });
});
