/** Builds the environment a lookup or download runs in, and logs through it under the module name "pdfFinding". */
import type { ILogger } from "../../ports/index.js";
import type { FetchFn, PdfFetchOptions, ResolverEnv } from "./types.js";

const MODULE = "pdfFinding";

const silentLogger: ILogger = {
  log: async () => undefined,
  error: async () => undefined,
};

/** The caller's fetch (or the global one, looked up at call time) wrapped so it is never called as a method. */
export function makeEnv(opts: PdfFetchOptions): ResolverEnv {
  const hostFetch = opts.fetch;
  return {
    fetch: hostFetch ? (...args: Parameters<FetchFn>) => hostFetch(...args) : (...args: Parameters<FetchFn>) => fetch(...args),
    logger: opts.logger ?? silentLogger,
  };
}

export function info(env: ResolverEnv, message: string, context: Record<string, unknown>): void {
  void env.logger.log("INFO", MODULE, message, context);
}

export function warn(env: ResolverEnv, message: string, context: Record<string, unknown>): void {
  void env.logger.log("WARN", MODULE, message, context);
}

export function reportError(env: ResolverEnv, error: unknown, context: Record<string, unknown>): void {
  void env.logger.error(MODULE, error, context);
}
