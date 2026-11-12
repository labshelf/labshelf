// Tests the Node source folder: listing skips tool folders, a read stays inside the folder even through symbolic links, and the git remote is found through a .git file.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSourceFolder, readGitRemote, readSourceFile } from "../../../../src/writing/outputLinks/node/index";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ls-outputs-"));
  await fs.mkdir(path.join(root, "code/results"), { recursive: true });
  await fs.mkdir(path.join(root, "code/node_modules/x"), { recursive: true });
  await fs.mkdir(path.join(root, "code/.cache"), { recursive: true });
  await fs.writeFile(path.join(root, "code/results/fig.png"), "png");
  await fs.writeFile(path.join(root, "code/node_modules/x/a.js"), "");
  await fs.writeFile(path.join(root, "code/.cache/b"), "");
  await fs.writeFile(path.join(root, "secret.txt"), "secret");
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe("source folder", () => {
  it("lists files, skipping hidden and tool folders", async () => {
    expect(await listSourceFolder(path.join(root, "code"))).toEqual(["results/fig.png"]);
  });

  it("reads inside the folder and refuses paths and links that leave it", async () => {
    const folder = path.join(root, "code");
    expect(new TextDecoder().decode(await readSourceFile(folder, "results/fig.png"))).toBe("png");
    expect(await readSourceFile(folder, "results/none.png")).toBeUndefined();
    await expect(readSourceFile(folder, "../secret.txt")).rejects.toThrow();
    await expect(readSourceFile(folder, "/etc/passwd")).rejects.toThrow();
    await expect(readSourceFile(folder, "results\\fig.png")).rejects.toThrow();
    await fs.symlink(path.join(root, "secret.txt"), path.join(folder, "link.txt"));
    await expect(readSourceFile(folder, "link.txt")).rejects.toThrow(/outside/);
  });

  it("reads the remote from .git/config and through a worktree's .git file", async () => {
    const main = path.join(root, "code");
    await fs.mkdir(path.join(main, ".git/worktrees/wt"), { recursive: true });
    await fs.writeFile(path.join(main, ".git/config"), '[remote "origin"]\n\turl = git@github.com:ana/e.git\n');
    await fs.writeFile(path.join(main, ".git/worktrees/wt/commondir"), "../..\n");
    expect(await readGitRemote(main)).toBe("git@github.com:ana/e.git");
    const worktree = path.join(root, "wt");
    await fs.mkdir(worktree);
    await fs.writeFile(path.join(worktree, ".git"), `gitdir: ${path.join(main, ".git/worktrees/wt")}\n`);
    expect(await readGitRemote(worktree)).toBe("git@github.com:ana/e.git");
    expect(await readGitRemote(root)).toBeUndefined();
  });
});
