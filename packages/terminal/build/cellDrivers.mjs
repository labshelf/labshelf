// Locates core's cell driver scripts, which the helper runs as files: the SEA embeds them and the helper script finds them beside itself.
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// mathDriver.wl is no language driver: cellDriver.wl Gets it from its own folder, so it ships and is written beside it.
export const CELL_DRIVER_FILES = ["cellDriver.py", "cellDriver.wl", "cellDriver.R", "mathDriver.wl"];

export const cellDriverPath = (file) => resolve(dirname(fileURLToPath(import.meta.url)), "../../core/src/qmd/compute/node", file);

// The pix2tex worker and its hash-pinned requirements files: core's pix2tex runner and provider find them beside the compiled module (equations/node), so the helper ships them beside its script.
const PIX2TEX_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../core/src/equations/node");
export const PIX2TEX_WORKER_FILE = "pix2tex_worker.py";
export const PIX2TEX_REQUIREMENTS_DIR = "pix2tex-requirements";
export const pix2texWorkerPath = () => resolve(PIX2TEX_DIR, PIX2TEX_WORKER_FILE);
export const pix2texRequirementsPath = () => resolve(PIX2TEX_DIR, PIX2TEX_REQUIREMENTS_DIR);
/** The requirements file names, read when the build runs. */
export const pix2texRequirementFiles = () => readdirSync(pix2texRequirementsPath()).filter((file) => file.endsWith(".txt")).sort();
