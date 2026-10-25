/** Builds the Native Messaging host manifest that lets the LabShelf extensions start a host. */
import { ALLOWED_EXTENSIONS, type NativeHostSpec } from "../../hostSpecs.js";
import type { BrowserFamily } from "./resolveHostLayout.js";

export interface HostManifest {
  name: string;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins?: string[];
  allowed_extensions?: string[];
}

export function buildHostManifest(spec: NativeHostSpec, family: BrowserFamily, executablePath: string): HostManifest {
  const base = { name: spec.hostName, description: spec.description, path: executablePath, type: "stdio" as const };
  return family === "firefox"
    ? { ...base, allowed_extensions: [ALLOWED_EXTENSIONS.firefoxId] }
    : { ...base, allowed_origins: [ALLOWED_EXTENSIONS.chromeOrigin] };
}
