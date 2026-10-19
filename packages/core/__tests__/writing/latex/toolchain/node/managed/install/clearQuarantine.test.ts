import { clearQuarantine } from "../../../../../../../src/writing/latex/toolchain/node/managed/install/clearQuarantine";
import { asLogger } from "../fakeTex";

const logger = () => ({ log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) });

describe("clearQuarantine", () => {
  it("removes the quarantine attribute recursively from the folder", async () => {
    const exec = jest.fn(async () => ({}));
    await clearQuarantine("/tex/tinytex", asLogger(logger()), exec);
    expect(exec).toHaveBeenCalledWith("/usr/bin/xattr", ["-dr", "com.apple.quarantine", "/tex/tinytex"]);
  });

  it("stays silent when nothing was quarantined", async () => {
    const log = logger();
    const exec = jest.fn(async () => { throw Object.assign(new Error("failed"), { stderr: "xattr: No such xattr: com.apple.quarantine" }); });
    await expect(clearQuarantine("/tex/tinytex", asLogger(log), exec)).resolves.toBeUndefined();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("logs any other failure with the folder and does not throw", async () => {
    const log = logger();
    const exec = jest.fn(async () => { throw new Error("Operation not permitted"); });
    await expect(clearQuarantine("/tex/tinytex", asLogger(log), exec)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ dir: "/tex/tinytex" }));
  });
});
