import { runMove } from "../../../src/cli/setup/moveCommand";
import { UsageError, type Output } from "../../../src/cli/usage";

describe("runMove", () => {
  const io: Output = { out: () => undefined, err: () => undefined, columns: 80 };
  const deps = { logger: () => undefined as never, env: {}, progress: () => undefined };

  it("needs a target path", async () => {
    await expect(runMove([], "/lib", io, deps)).rejects.toThrow(UsageError);
  });

  it("needs a configured library", async () => {
    await expect(runMove(["/elsewhere"], undefined, io, deps)).rejects.toThrow(/No library/);
  });
});
