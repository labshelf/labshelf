// Names the native-messaging hosts LabShelf registers and the extension ids allowed to start them.
import { BRIDGE_HOST_NAME } from "../bridge/index.js";
import { HELPER_HOST_NAME } from "../helper/index.js";

export interface NativeHostSpec {
  /** The `name` browsers look the host up by. */
  hostName: string;
  description: string;
  /** Folder under the LabShelf config folder that holds the launcher, host.json and, on Windows, the manifests. */
  dirName: string;
}

export const BRIDGE_HOST_SPEC: NativeHostSpec = { hostName: BRIDGE_HOST_NAME, description: "LabShelf bridge to the library folder", dirName: "bridge" };

export const HELPER_HOST_SPEC: NativeHostSpec = { hostName: HELPER_HOST_NAME, description: "LabShelf Helper", dirName: "helper" };

export const ALLOWED_EXTENSIONS = {
  // The `key` in packages/browser/manifest.chrome.json fixes this id for both store and unpacked builds.
  chromeOrigin: "chrome-extension://ghcjlkjggiffdekaneoaoklhedjeeklh/",
  // The `browser_specific_settings.gecko.id` in packages/browser/manifest.firefox.json.
  firefoxId: "labshelf@lucanaasser.dev",
} as const;
