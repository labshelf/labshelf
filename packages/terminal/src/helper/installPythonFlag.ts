// The `--install-python` mode of the helper binary: the installers run it to lay the shared managed Python beside the helper.
import type { PythonProvider } from "@labshelf/core/node";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Installs Python through `provider` and returns the process exit code; failures are reported through `write`, never thrown. */
export async function runInstallPython(provider: PythonProvider, write: (message: string) => void): Promise<number> {
  try {
    const status = await provider.install((message) => write(message));
    if (status.state !== "installed") {
      write("Python install failed: the install finished without a usable Python");
      return 1;
    }
    write(`Python ${status.version} installed`);
    return 0;
  } catch (error) {
    write(`Python install failed: ${describe(error)}`);
    return 1;
  }
}
