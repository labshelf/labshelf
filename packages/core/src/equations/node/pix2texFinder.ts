// Finds a Python that has pix2tex: the setting first, then the managed install, then the system's.
import type { ILogger } from "../../ports/index.js";
import type { Pix2texProvider } from "./installPix2tex.js";

const MODULE = "equations/node/pix2texRunner";

export type Pix2texFound = { python: string; origin: 'setting' | 'managed' | 'system'; weightsDir?: string };

export interface Pix2texFinderDeps {
  settingPython(): string | undefined;
  managed: Pick<Pix2texProvider, 'status' | 'pythonPath' | 'weightsDir'>;
  locatePython(): Promise<string | undefined>;
  canImport(python: string): Promise<boolean>;
  logger: ILogger;
}

/** @returns the lookup of the Python to read with; whether a system Python can import pix2tex is asked once per Python. */
export function createPix2texFinder(deps: Pix2texFinderDeps): () => Promise<Pix2texFound | undefined> {
  const importable = new Map<string, Promise<boolean>>();

  function canImport(python: string): Promise<boolean> {
    let known = importable.get(python);
    if (known === undefined) {
      known = deps.canImport(python).catch((error: unknown) => {
        void deps.logger.error(MODULE, error, { python }).catch(() => undefined);
        return false;
      });
      importable.set(python, known);
    }
    return known;
  }

  return async () => {
    const setting = deps.settingPython();
    if (setting !== undefined && setting !== "") { return { python: setting, origin: "setting" }; }
    if (await deps.managed.status() === "installed") {
      return { python: deps.managed.pythonPath(), origin: "managed", weightsDir: deps.managed.weightsDir() };
    }
    const system = await deps.locatePython();
    if (system !== undefined && await canImport(system)) { return { python: system, origin: "system" }; }
    return undefined;
  };
}
