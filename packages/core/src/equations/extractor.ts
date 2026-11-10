/** Builds the equation port from an ordered list of sources: the first one with LaTeX wins, and when none has any the reader gets the offers. */
import type { ILogger } from "../ports/index.js";
import type { EquationPort, EquationRequest } from "../reader/hostPorts.js";

const MODULE = "equations/extractor";

export interface EquationSource { id: 'arxiv' | 'pix2tex' | 'ai'; available(request: EquationRequest): Promise<boolean>; read(request: EquationRequest, onProgress: (m: string, f?: number) => void, signal?: AbortSignal): Promise<{ latex: string; provider?: string; number?: string; label?: string } | undefined> }

export interface EquationOffers { pix2tex(): Promise<'install' | 'installHelper' | 'none'>; aiKey(): boolean }

export function createEquationExtractor(deps: { sources: EquationSource[]; offers: EquationOffers; logger: ILogger; installPix2tex?: EquationPort['installPix2tex']; addAiKey?: EquationPort['addAiKey'] }): EquationPort {
  const { sources, offers, logger } = deps;
  const port: EquationPort = {
    async extract(request, onProgress, signal) {
      if (signal?.aborted) { return { kind: "failed", reason: "cancelled" }; }
      for (const source of sources) {
        try {
          if (!(await source.available(request))) { continue; }
          const found = await source.read(request, onProgress, signal);
          if (signal?.aborted) { return { kind: "failed", reason: "cancelled" }; }
          if (found !== undefined) {
            return {
              kind: "latex",
              latex: found.latex,
              source: source.id,
              ...(found.provider !== undefined ? { provider: found.provider } : {}),
              ...(found.number !== undefined ? { number: found.number } : {}),
              ...(found.label !== undefined ? { label: found.label } : {}),
            };
          }
        } catch (error) {
          if (signal?.aborted) { return { kind: "failed", reason: "cancelled" }; }
          void logger.error(MODULE, error, { source: source.id, paperId: request.paperId });
        }
      }
      return { kind: "unavailable", offers: { pix2tex: await offers.pix2tex(), aiKey: offers.aiKey() } };
    },
    ...(deps.installPix2tex ? { installPix2tex: deps.installPix2tex } : {}),
    ...(deps.addAiKey ? { addAiKey: deps.addAiKey } : {}),
  };
  return port;
}
