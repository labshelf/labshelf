// Core test setup: exposes Web Crypto and setImmediate as globals where the environment lacks them (Node versions, jsdom).
if (typeof (globalThis as { crypto?: unknown }).crypto === "undefined") {
  const { webcrypto } = require("node:crypto") as { webcrypto: unknown };
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

if (typeof (globalThis as { setImmediate?: unknown }).setImmediate === "undefined") {
  Object.defineProperty(globalThis, "setImmediate", { value: (fn: () => void) => setTimeout(fn, 0), configurable: true });
}

afterEach(() => {
  jest.clearAllMocks();
});

// Device-local files resolve under XDG_STATE_HOME and XDG_CACHE_HOME; tests must never write to the real ones.
{
  const os = require("node:os") as typeof import("node:os");
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const created: string[] = [];
  for (const name of ["XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-xdg-"));
    process.env[name] = dir;
    created.push(dir);
  }
  afterAll(() => {
    for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
  });
}
