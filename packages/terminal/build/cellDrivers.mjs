// Locates core's cell driver scripts, which the helper runs as files: the SEA embeds them and the helper script finds them beside itself.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CELL_DRIVER_FILES = ["cellDriver.py", "cellDriver.wl", "cellDriver.R"];

export const cellDriverPath = (file) => resolve(dirname(fileURLToPath(import.meta.url)), "../../core/src/qmd/compute/node", file);
