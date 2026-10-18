// Builds the native-messaging host manifest a browser reads to launch the helper.
import { HELPER_ALLOWED_ORIGINS, HELPER_FIREFOX_EXTENSIONS, HELPER_HOST_NAME } from "./allowedOrigins.js";

export type BrowserFamily = "chromium" | "firefox";

interface HostManifest {
  name: string;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins?: string[];
  allowed_extensions?: string[];
}

export function buildHostManifest(family: BrowserFamily, binaryPath: string): HostManifest {
  const base = { name: HELPER_HOST_NAME, description: "LabShelf Helper", path: binaryPath, type: "stdio" as const };
  return family === "firefox"
    ? { ...base, allowed_extensions: HELPER_FIREFOX_EXTENSIONS }
    : { ...base, allowed_origins: HELPER_ALLOWED_ORIGINS };
}
