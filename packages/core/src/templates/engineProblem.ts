/** Explains why a template cannot be built on this machine: its engine is missing or its Typst version is too old. */

import type { TemplateEntry } from "./templateEntry.js";
import type { TemplateEngine } from "./templateManifest/index.js";
import { isNewerVersion } from "./sources/index.js";

export interface AvailableEngines {
  engines: ReadonlySet<TemplateEngine>;
  typstVersion: string;
}

export function engineProblem(entry: TemplateEntry, available: AvailableEngines): string | undefined {
  if (!available.engines.has(entry.engine)) { return `Needs ${entry.engine}, which is not available on this machine`; }
  if (entry.engine === "typst" && entry.compiler !== undefined && isNewerVersion(entry.compiler, available.typstVersion)) {
    return `Needs Typst ${entry.compiler}; this machine has ${available.typstVersion}`;
  }
  return undefined;
}
