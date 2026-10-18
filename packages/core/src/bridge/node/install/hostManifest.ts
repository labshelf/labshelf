/** Builds the Native Messaging host manifest that lets the LabShelf extensions start the bridge. */
import { BRIDGE_HOST_NAME } from "../../index.js";
import type { BrowserFamily } from "./browserTargets.js";

// The `key` in packages/browser/manifest.chrome.json fixes this id for both store and unpacked builds.
const CHROME_EXTENSION_ID = "ghcjlkjggiffdekaneoaoklhedjeeklh";
// The `browser_specific_settings.gecko.id` in packages/browser/manifest.firefox.json.
const FIREFOX_EXTENSION_ID = "labshelf@lucanaasser.dev";

export interface HostManifest {
  name: string;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins?: string[];
  allowed_extensions?: string[];
}

export function buildHostManifest(family: BrowserFamily, launcherPath: string): HostManifest {
  const base = { name: BRIDGE_HOST_NAME, description: "LabShelf bridge to the library folder", path: launcherPath, type: "stdio" as const };
  return family === "firefox"
    ? { ...base, allowed_extensions: [FIREFOX_EXTENSION_ID] }
    : { ...base, allowed_origins: [`chrome-extension://${CHROME_EXTENSION_ID}/`] };
}
