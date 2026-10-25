/** Verifies the install-and-rebuild loop: a forced rebuild after an install, the round cap and a file that cannot be installed. */
import { compileInstallingPackages } from "../../../../src/writing/build/node/index";
import { fakeLogger } from "../../../support/fakeLogger";

interface Round { force: boolean; missing?: string }

function run(missingRounds: number, installs = true): Promise<{ rounds: Round[]; installed: string[]; last: Round }> {
  const rounds: Round[] = [];
  const installed: string[] = [];
  return compileInstallingPackages<Round>({
    compile: async ({ force }) => {
      const round: Round = { force, ...(rounds.length < missingRounds && { missing: `p${rounds.length}.sty` }) };
      rounds.push(round);
      return round;
    },
    missingFile: (result) => result.missing,
    tex: { installMissing: async (fileName) => { installed.push(fileName); return installs; } },
    logger: fakeLogger(),
  }).then((last) => ({ rounds, installed, last }));
}

describe("compileInstallingPackages", () => {
  it("installs a missing file and rebuilds with force", async () => {
    const { rounds, installed, last } = await run(1);
    expect(rounds.map((r) => r.force)).toEqual([false, true]);
    expect(installed).toEqual(["p0.sty"]);
    expect(last.missing).toBeUndefined();
  });

  it("stops after ten install rounds", async () => {
    const { rounds, installed, last } = await run(100);
    expect(installed).toHaveLength(10);
    expect(rounds).toHaveLength(11);
    expect(last.missing).toBe("p10.sty");
  });

  it("stops when the missing file cannot be installed", async () => {
    const { rounds, installed } = await run(5, false);
    expect(rounds).toHaveLength(1);
    expect(installed).toEqual(["p0.sty"]);
  });
});
