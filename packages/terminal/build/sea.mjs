// Builds dist/sea/labshelf-helper-<os>-<arch>, a Node single executable of LabShelf Helper for the host, and checks that it answers `hello` with `ready` and `session` and, when it carries biber's WASM, that its `--biber` mode writes a .bbl.
import { build } from "esbuild";
import { execFileSync, spawn } from "node:child_process";
import { chmod, cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inject } from "postject";
import { BIBER_WASM_FILES, biberWasmDir } from "./biberWasm.mjs";
import { TYPST_WASM_FILE, typstWasmPath } from "./typstWasm.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seaDir = resolve(root, "dist/sea");
const OS_NAMES = { darwin: "macos", win32: "windows", linux: "linux" };
const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const SMOKE_TIMEOUT_MS = 20_000;
const protocolSource = await readFile(resolve(root, "../core/src/writing/helper/helperMessages.ts"), "utf8");
const protocolMatch = protocolSource.match(/^export const PROTOCOL_VERSION = (\d+);$/m);
if (!protocolMatch) throw new Error("Cannot read the helper protocol version from core");
const PROTOCOL_VERSION = Number(protocolMatch[1]);
const SMOKE_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

function targetName() {
  const osName = OS_NAMES[process.platform];
  if (!osName || !["x64", "arm64"].includes(process.arch)) {
    throw new Error(`No SEA target for ${process.platform}-${process.arch}`);
  }
  return `labshelf-helper-${osName}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
}

// PLATFORM: a SEA main must be a script, not an ES module, so the ESM bundle is re-bundled as one CommonJS file on every Node version.
async function bundleCommonJs(outfile) {
  await build({
    entryPoints: [resolve(root, "dist/labshelf-helper.mjs")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    legalComments: "none",
    logLevel: "warning",
    // TRAP: typst.ts imports its renderer, an optional peer the helper never loads, so it stays out of the bundle.
    external: ["@myriaddreamin/typst-ts-renderer"],
    // The ESM bundle's banner builds `require` from import.meta.url; in the executable that is the binary's own location.
    define: { "import.meta.url": "__helperUrl" },
    banner: { js: 'const __helperUrl = require("node:url").pathToFileURL(__filename).href;' },
  });
}

// biber's files go in as `biber-wasm/<file>`, the names `seaBiberAssets` reads; without a biber build the helper keeps the TeX's own biber.
function biberAssets() {
  const dir = biberWasmDir();
  if (!dir) { console.log("[labshelf-helper-sea] no biber WASM build; the helper runs the TeX's own biber"); }
  return dir ? Object.fromEntries(BIBER_WASM_FILES.map((file) => [`biber-wasm/${file}`, join(dir, file)])) : {};
}

// The executable has no node_modules, so the compiler WASM is a SEA asset that `main.ts` reads with getAsset.
async function writeBlob(tmpDir, mainFile) {
  const config = join(tmpDir, "sea-config.json");
  const blob = join(tmpDir, "sea-prep.blob");
  const assets = { [TYPST_WASM_FILE]: typstWasmPath(), ...biberAssets() };
  await writeFile(config, JSON.stringify({ main: mainFile, output: blob, disableExperimentalSEAWarning: true, assets }));
  try {
    execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "inherit" });
  } catch {
    // TRAP: distro and Homebrew Node builds omit SEA support and fail here with "Single executable application is disabled".
    throw new Error(`${process.execPath} cannot build a single executable application; run this script with an official nodejs.org build`);
  }
  return blob;
}

async function injectBlob(binary, blob) {
  const isMac = process.platform === "darwin";
  if (isMac) { execFileSync("codesign", ["--remove-signature", binary], { stdio: "inherit" }); }
  await inject(binary, "NODE_SEA_BLOB", await readFile(blob), {
    sentinelFuse: SENTINEL_FUSE,
    ...(isMac ? { machoSegmentName: "NODE_SEA" } : {}),
  });
  if (isMac) { execFileSync("codesign", ["--sign", "-", binary], { stdio: "inherit" }); }
}

function encodeFrame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Returns every complete frame in `buffer`; a partial trailing frame is left out. */
function framesIn(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length >= offset + 4 && buffer.length >= offset + 4 + buffer.readUInt32LE(offset)) {
    const length = buffer.readUInt32LE(offset);
    frames.push(JSON.parse(buffer.subarray(offset + 4, offset + 4 + length).toString("utf8")));
    offset += 4 + length;
  }
  return frames;
}

// The helper writes logs and checks for updates; a scratch home keeps both away from the user's real data folder.
async function smokeCheck(binary, scratchHome) {
  const env = { ...process.env, HOME: scratchHome, USERPROFILE: scratchHome, LOCALAPPDATA: scratchHome, XDG_DATA_HOME: scratchHome };
  const child = spawn(binary, [], { env, stdio: ["pipe", "pipe", "pipe"] });
  try {
    const replies = await new Promise((resolveReply, reject) => {
      let received = Buffer.alloc(0);
      let stderr = "";
      const timer = setTimeout(() => reject(new Error(`no ready and session within ${SMOKE_TIMEOUT_MS} ms; stderr: ${stderr.trim() || "(empty)"}`)), SMOKE_TIMEOUT_MS);
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("exit", (code) => reject(new Error(`helper exited with code ${code} before replying; stderr: ${stderr.trim() || "(empty)"}`)));
      child.stdout.on("data", (chunk) => {
        received = Buffer.concat([received, chunk]);
        const frames = framesIn(received);
        if (frames.length >= 2) { clearTimeout(timer); resolveReply(frames); }
      });
      child.stdin.write(encodeFrame({ v: PROTOCOL_VERSION, id: "smoke", type: "hello", extensionVersion: "0.0.0", origin: SMOKE_ORIGIN }));
    });
    const [ready, session] = replies;
    if (ready.type !== "ready" || ready.id !== "smoke") { throw new Error(`expected ready for hello, got ${JSON.stringify(ready)}`); }
    if (session.type !== "session" || !Number.isInteger(session.port) || typeof session.token !== "string") { throw new Error(`expected session with a port and a token, got ${JSON.stringify(session)}`); }
    return { ready: ready.type, session: { type: session.type, port: session.port } };
  } finally {
    child.removeAllListeners("exit");
    child.kill();
  }
}

// The control file and bibliography core's biber tests use.
const BIBER_FIXTURES = resolve(root, "../core/__tests__/latex/biber/fixtures");

async function biberSmokeCheck(binary, tmpDir, scratchHome) {
  const project = join(tmpDir, "biber project");
  await cp(BIBER_FIXTURES, project, { recursive: true });
  await rm(join(project, "main.bbl"));
  const env = { ...process.env, HOME: scratchHome, USERPROFILE: scratchHome, LOCALAPPDATA: scratchHome, XDG_DATA_HOME: scratchHome };
  try {
    execFileSync(binary, ["--biber", "--root", project, join(project, "main.bcf")], { cwd: project, env, stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    throw new Error(`--biber failed: ${error.stderr?.toString().trim() || error.message}`);
  }
  const entries = (await readFile(join(project, "main.bbl"), "utf8")).match(/\\entry\{/g)?.length ?? 0;
  if (entries === 0) { throw new Error("--biber wrote a .bbl without entries"); }
  return entries;
}

async function main() {
  const binary = join(seaDir, targetName());
  await mkdir(seaDir, { recursive: true });
  const tmpDir = await mkdtemp(join(seaDir, "tmp-"));
  try {
    const mainFile = join(tmpDir, "labshelf-helper.cjs");
    await bundleCommonJs(mainFile);
    const blob = await writeBlob(tmpDir, mainFile);
    await rm(binary, { force: true });
    await copyFile(process.execPath, binary);
    // PLATFORM: the Linux arm64 runner's Node is mode 777, which copyFile keeps and the helper's private-path check refuses.
    await chmod(binary, 0o755);
    await injectBlob(binary, blob);
    const reply = await smokeCheck(binary, join(tmpDir, "home"));
    console.log(`[labshelf-helper-sea] built ${binary}; hello answered with ${JSON.stringify(reply)}`);
    if (biberWasmDir()) { console.log(`[labshelf-helper-sea] --biber wrote ${await biberSmokeCheck(binary, tmpDir, join(tmpDir, "home"))} entries`); }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[labshelf-helper-sea] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
