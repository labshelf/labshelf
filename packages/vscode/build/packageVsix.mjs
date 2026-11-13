/** Packages the extension as labshelf-<target>.vsix for one platform: a production build, its runtime files and the production node_modules of that platform. */
// Usage: node build/packageVsix.mjs [--target=linux-arm64]  (default: this machine's platform)
// The .vsix lands in $LABSHELF_VM_SHARE when set (the folder a test VM reads), else in packages/vscode.
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(pkgRoot, ".vsix-stage");
const RUNTIME_DIRS = ["out", "dist", "media", "syntaxes", "language-configuration"];
// vsce target → the npm --os/--cpu/--libc flags that pick that platform's native binaries (@napi-rs/canvas).
const TARGETS = {
  "linux-arm64": ["--os=linux", "--cpu=arm64", "--libc=glibc"],
  "linux-x64": ["--os=linux", "--cpu=x64", "--libc=glibc"],
  "darwin-arm64": ["--os=darwin", "--cpu=arm64"],
  "darwin-x64": ["--os=darwin", "--cpu=x64"],
  "win32-x64": ["--os=win32", "--cpu=x64"],
  "win32-arm64": ["--os=win32", "--cpu=arm64"],
};

function parseTarget() {
  const arg = process.argv.find((a) => a.startsWith("--target="));
  const target = arg ? arg.slice("--target=".length) : `${process.platform}-${process.arch}`;
  if (!TARGETS[target]) throw new Error(`Unknown --target=${target}. Expected one of: ${Object.keys(TARGETS).join(", ")}`);
  return target;
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

/** The manifest vsce accepts: an unscoped name, no workspace packages (they are bundled), and the dependency versions installed here. */
async function writeManifest() {
  const require = createRequire(join(pkgRoot, "package.json"));
  const manifest = require("./package.json");
  manifest.name = "labshelf";
  const dependencies = {};
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (name.startsWith("@labshelf/")) continue;
    dependencies[name] = require(`${name}/package.json`).version;
  }
  manifest.dependencies = dependencies;
  delete manifest.devDependencies;
  delete manifest.scripts;
  await writeFile(join(stage, "package.json"), JSON.stringify(manifest, null, 2));
}

async function main() {
  const target = parseTarget();
  const outFile = join(process.env.LABSHELF_VM_SHARE || pkgRoot, `labshelf-${target}.vsix`);
  run("node", ["build/host.mjs", "--production"], pkgRoot);
  run("node", ["build/webviews.mjs", "--production"], pkgRoot);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  try {
    for (const dir of RUNTIME_DIRS) {
      if (existsSync(join(pkgRoot, dir))) await cp(join(pkgRoot, dir), join(stage, dir), { recursive: true });
    }
    await writeManifest();
    await writeFile(join(stage, ".vscodeignore"), "**/*.map\n**/*.d.ts\n");
    run("npm", ["install", "--omit=dev", "--no-package-lock", "--ignore-scripts", ...TARGETS[target]], stage);
    run("npx", ["--yes", "@vscode/vsce", "package", "--target", target, "--allow-missing-repository", "--skip-license", "-o", outFile], stage);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  // eslint-disable-next-line no-console
  console.log(`[labshelf-vscode] packaged ${target} → ${outFile}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
