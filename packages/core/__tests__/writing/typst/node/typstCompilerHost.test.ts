/** Verifies the shared Typst compiler host opens once and tries again after a failed open. */
import * as path from "node:path";

import { TypstCompilerHost } from "../../../../src/writing/typst/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

async function hostWith(wasm: jest.Mock): Promise<TypstCompilerHost> {
  const dir = await makeTempDir();
  return new TypstCompilerHost({ wasm, fontsDir: path.join(dir, "fonts"), packageDirs: { data: path.join(dir, "local"), cache: path.join(dir, "cache") } });
}

describe("TypstCompilerHost", () => {
  it("shares one open between concurrent callers", async () => {
    const wasm = jest.fn(() => Promise.reject(new Error("no wasm")));
    const host = await hostWith(wasm);
    const logger = fakeLogger();
    const results = await Promise.allSettled([host.get(logger), host.get(logger)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(wasm).toHaveBeenCalledTimes(1);
  });

  it("opens again on the next call after a failed open", async () => {
    const wasm = jest.fn(() => Promise.reject(new Error("no wasm")));
    const host = await hostWith(wasm);
    await expect(host.get(fakeLogger())).rejects.toThrow("no wasm");
    await expect(host.get(fakeLogger())).rejects.toThrow("no wasm");
    expect(wasm).toHaveBeenCalledTimes(2);
  });
});
