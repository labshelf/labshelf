/** A routed fake network and a recording logger for the PDF finder: URL to canned Response, every call kept. */
import type { ILogger, PdfFetchOptions, ResolveContext } from "@labshelf/core";

import type { ResolverEnv } from "../../src/import/pdfFinder/pdfResolver";

export const PDF = new TextEncoder().encode("%PDF-1.5 body");

export interface LogCall { level: string; module: string; message: string; context: Record<string, unknown> | undefined }

export type Routes = Record<string, () => Response | Promise<Response>>;

export interface FindingHarness {
  routes: Routes;
  /** Every URL requested, in order. */
  calls: string[];
  logs: LogCall[];
  logger: ILogger;
  /** Resolver-level environment over the routed network. */
  env: ResolverEnv;
  /** Options for the download and chain entry points over the routed network. */
  opts(over?: PdfFetchOptions): PdfFetchOptions;
}

export const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
export const html = (body: string, status = 200): Response => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
export const pdf = (): Response => new Response(PDF, { headers: { "content-type": "application/octet-stream" } });

export function makeFindingHarness(): FindingHarness {
  const routes: Routes = {};
  const calls: string[] = [];
  const logs: LogCall[] = [];
  const logger: ILogger = {
    log: async (level, module, message, context) => { logs.push({ level, module, message, context }); },
    error: async (module, error, context) => { logs.push({ level: "ERROR", module, message: String(error), context }); },
  };
  const fetchRouted = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    return (await routes[url]?.()) ?? new Response("not found", { status: 404 });
  };
  return {
    routes, calls, logs, logger,
    env: { fetch: fetchRouted as typeof fetch, logger },
    opts: (over = {}) => ({ fetch: fetchRouted as typeof fetch, logger, ...over }),
  };
}

export function makeContext(over: Partial<ResolveContext> = {}): ResolveContext {
  return { pageCandidates: [], contactEmail: "me@uni.edu", ...over };
}
