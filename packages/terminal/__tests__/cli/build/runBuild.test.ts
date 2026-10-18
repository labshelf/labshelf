// Tests for `labshelf build`: the diagnostic line format, the exit codes and the rebuild on a source change.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ProjectBuildResult } from "@labshelf/core";

import { UsageError, type Output } from "../../../src/cli";
import { runBuild, terminalBuildEnvironment, type BuildEnvironment } from "../../../src/cli/build";
import { LibraryRoot } from "../../../src/library";
import { cleanupTempDirs, makeTempDir } from "../../fixtures/library";

// The machine running the tests may have a TeX; the real provider would find it and build.
jest.mock("@labshelf/core/node", () => {
  const actual = jest.requireActual("@labshelf/core/node");
  const { join } = jest.requireActual("node:path");
  const { tmpdir } = jest.requireActual("node:os");
  return {
    ...actual,
    createSharedTexProvider: ({ logger }: { logger: unknown }) => actual.createManagedTexProvider({
      texRoot: join(tmpdir(), `labshelf-no-tex-${process.pid}`),
      logger,
      system: { resolve: async () => "missing", installMissing: async () => false },
      installers: { tinytex: async () => undefined, texlive: async () => undefined },
    }),
  };
});

afterEach(cleanupTempDirs);

const logger = { log: async () => undefined, error: async () => undefined };
const PROJECT = "id: thesis\nformat: latex\nmain: main.tex\n";

async function setup() {
  const library = await makeTempDir("labshelf-build-lib-");
  const projectDir = await makeTempDir("labshelf-build-project-");
  await fs.writeFile(path.join(projectDir, "labshelf.yaml"), PROJECT);
  const out: string[] = [];
  const err: string[] = [];
  const io: Output = { out: (t) => out.push(t), err: (t) => err.push(t), columns: 100 };
  const ctx = { logger, paths: new LibraryRoot(library) };
  return { ctx, projectDir, io, out, err };
}

function fakeEnvironment(results: ProjectBuildResult[]) {
  const requests: string[] = [];
  const watchers: Array<() => void> = [];
  let interrupt!: () => void;
  const interrupted = new Promise<void>((resolve) => { interrupt = resolve; });
  const env: BuildEnvironment = {
    queue: {
      request: async (project) => { requests.push(project.folder); return results.shift() ?? { status: "cancelled" }; },
      cancelAll: () => undefined,
    },
    watchSources: (_folder, onChange) => { watchers.push(onChange); return () => undefined; },
    interrupted: () => interrupted,
  };
  return { env, requests, watchers, interrupt };
}

describe("runBuild output and exit codes", () => {
  it("prints each problem as path:line: severity: message with the hint indented, and exits 1 on a failed build", async () => {
    const { ctx, projectDir, io, out } = await setup();
    const { env } = fakeEnvironment([{
      status: "failed",
      problems: [
        { severity: "error", message: "Undefined control sequence", hint: "Check the spelling of \\foo.", file: "chapters/one.tex", line: 12 },
        { severity: "warning", message: "Overfull hbox", file: "main.tex" },
      ],
    }]);
    const code = await runBuild(ctx, [projectDir], {}, io, env);
    expect(code).toBe(1);
    const lines = out.join("\n").split("\n");
    expect(lines).toContain(`${path.relative(process.cwd(), path.join(projectDir, "chapters/one.tex"))}:12: error: Undefined control sequence`);
    expect(lines[lines.indexOf(lines.find((l) => l.endsWith("error: Undefined control sequence"))!) + 1]).toBe("  Check the spelling of \\foo.");
    expect(lines.some((l) => l.endsWith("main.tex:1: warning: Overfull hbox") || l.endsWith("main.tex: warning: Overfull hbox"))).toBe(true);
  });

  it("exits 0 on success, naming the PDF", async () => {
    const { ctx, projectDir, io, out } = await setup();
    const { env } = fakeEnvironment([{ status: "succeeded", pdf: path.join(projectDir, "main.pdf"), problems: [] }]);
    expect(await runBuild(ctx, [projectDir], {}, io, env)).toBe(0);
    expect(out.join("\n")).toContain("main.pdf");
  });

  it("exits 2 with the LaTeX install hint when the toolchain is missing", async () => {
    const { ctx, projectDir, io, err } = await setup();
    const { env } = fakeEnvironment([{ status: "toolchain-missing", reason: "declined" }]);
    expect(await runBuild(ctx, [projectDir], {}, io, env)).toBe(2);
    expect(err.join("\n")).toContain("No LaTeX found");
  });

  it("exits 2 naming the failure when the LaTeX install fails", async () => {
    const { ctx, projectDir, io, err } = await setup();
    const { env } = fakeEnvironment([{ status: "toolchain-missing", reason: "install-failed", message: "disk full" }]);
    expect(await runBuild(ctx, [projectDir], {}, io, env)).toBe(2);
    expect(err.join("\n")).toContain("Installing LaTeX failed: disk full");
  });

  it("declines the first-run toolchain question without a TTY: exit 2 and the install hint, no build", async () => {
    const { ctx, projectDir, io, err } = await setup();
    const env = terminalBuildEnvironment(ctx, { ask: undefined });
    expect(await runBuild(ctx, [projectDir], {}, io, env)).toBe(2);
    expect(err.join("\n")).toContain("No LaTeX found");
  });

  it("rejects a folder that is not a writing project", async () => {
    const { ctx, io } = await setup();
    const empty = await makeTempDir("labshelf-build-empty-");
    const { env } = fakeEnvironment([]);
    await expect(runBuild(ctx, [empty], {}, io, env)).rejects.toBeInstanceOf(UsageError);
  });
});

describe("runBuild --watch", () => {
  it("rebuilds once per source change and returns 0 on interrupt", async () => {
    const { ctx, projectDir, io, out } = await setup();
    const fake = fakeEnvironment([
      { status: "failed", problems: [{ severity: "error", message: "first", file: "main.tex", line: 1 }] },
      { status: "succeeded", pdf: path.join(projectDir, "main.pdf"), problems: [] },
    ]);
    const done = runBuild(ctx, [projectDir], { watch: true }, io, fake.env);
    await waitFor(() => fake.watchers.length === 1 && fake.requests.length === 1);
    fake.watchers[0]!();
    await waitFor(() => fake.requests.length === 2);
    await waitFor(() => out.join("\n").includes("main.pdf"));
    fake.interrupt();
    expect(await done).toBe(0);
    expect(fake.requests).toHaveLength(2);
    expect(out.join("\n")).toContain("first");
  });

  it("stops without watching when the toolchain is missing", async () => {
    const { ctx, projectDir, io } = await setup();
    const fake = fakeEnvironment([{ status: "toolchain-missing", reason: "declined" }]);
    expect(await runBuild(ctx, [projectDir], { watch: true }, io, fake.env)).toBe(2);
    expect(fake.watchers).toHaveLength(0);
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) { await new Promise((resolve) => setTimeout(resolve, 5)); }
  if (!condition()) { throw new Error("condition not met"); }
}
