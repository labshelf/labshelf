// Binds the line-by-line text merge to node-diff3 as Node loads it.
import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };
import { createTextMerge } from "../textMerge.js";

// TRAP: node-diff3 ships ESM types only, so this CommonJS-compiled package cannot import it statically, and the
// `require` binding keeps this file Node-only; its `require` export is the CommonJS build Jest and the bundles load.
const { diff3Merge } = require("node-diff3") as typeof NodeDiff3;

export const mergeText = createTextMerge(diff3Merge);
