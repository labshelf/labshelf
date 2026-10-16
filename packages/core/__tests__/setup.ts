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
