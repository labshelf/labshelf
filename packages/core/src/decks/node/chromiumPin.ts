// The pinned chrome-headless-shell: one Chrome for Testing Stable version, its zip, SHA-256 and executable per platform.
export interface ChromiumPinEntry { url: string; sha256: string; executable: string }

export interface ChromiumPin { version: string; platforms: Partial<Record<"darwin-arm64" | "darwin-x64" | "linux-x64" | "win32-x64", ChromiumPinEntry>> }

const VERSION = "156.0.8078.80";

function entry(cft: string, sha256: string, exe = ""): ChromiumPinEntry {
  return {
    url: `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/${cft}/chrome-headless-shell-${cft}.zip`,
    sha256,
    executable: `chrome-headless-shell-${cft}/chrome-headless-shell${exe}`,
  };
}

// Taken 2026-11-01 from the Chrome for Testing Stable channel; each sha256 was computed from the downloaded zip.
// linux-arm64 has no chrome-headless-shell build, so it has no entry.
const PIN: ChromiumPin = {
  version: VERSION,
  platforms: {
    "darwin-arm64": entry("mac-arm64", "ea615baa2e9caf0d02d1898a6562b5f8fa9c35239707dae0f592178df5b986ac"),
    "darwin-x64": entry("mac-x64", "535d417d9034cbd11e7dacd1a71aa3d6e1b525e6d5dcd2671eb2532f01481228"),
    "linux-x64": entry("linux64", "547dcd374e02961bf998f6046a267644f8502225c36bb78ca307dab32a0b3eb4"),
    "win32-x64": entry("win64", "10a77466005e7f64e00f1a75fd1ea81f4a38a60093c65fea6895843b26e60a9a", ".exe"),
  },
};

/** A fresh deep copy of the pin, so callers may change it freely. */
export function chromiumPin(): ChromiumPin {
  const platforms: ChromiumPin["platforms"] = {};
  for (const [key, value] of Object.entries(PIN.platforms)) {
    platforms[key as keyof ChromiumPin["platforms"]] = { ...value };
  }
  return { version: PIN.version, platforms };
}
