// Answers the socket's equation messages: ocr reads the payload PNG with pix2tex and replies ocrResult or ocrFailed, cancelOcr aborts a run by
// its request id, and installPix2tex installs the managed pix2tex with progress, ending in a ready.
// CONTRACT: documents/contracts/helper.md#messages
import { formatError } from "../../errors/index.js";
import type { ILogger } from "../../ports/index.js";
import type { Pix2texProvider } from "../../equations/node/installPix2tex.js";
import type { Pix2texRunner } from "../../equations/node/pix2texRunner.js";
import { MAX_OCR_PNG_BYTES, PROTOCOL_VERSION, type HelperHost, type HelperOcrFailure, type PythonState, type TexToolchain } from "../helperMessages.js";
import { HELPER_CAPABILITIES, type HelperHandler, type HelperSend } from "./helperHandlers.js";

const MODULE = "helper-ocr";
const NOT_INSTALLED = "pix2tex is not installed.";

export interface OcrHandlerDeps {
  runner: Pick<Pix2texRunner, "find" | "read">;
  provider: Pick<Pix2texProvider, "install">;
  readyFields(): Promise<{ helperVersion: string; host: HelperHost; tex: TexToolchain; python?: PythonState }>;
  logger: ILogger;
}

const failed = (send: HelperSend, id: string, reason: HelperOcrFailure, message: string) => send({ v: PROTOCOL_VERSION, id, type: "ocrFailed", reason, message });

/** ocr, cancelOcr and installPix2tex over one map of running reads. */
export function createOcrHandlers(deps: OcrHandlerDeps): Record<"ocr" | "cancelOcr" | "installPix2tex", HelperHandler> {
  const { runner, provider, logger } = deps;
  const running = new Map<string, AbortController>();
  // INVARIANT: the controller is registered before any await, because the dispatcher runs a cancelOcr without waiting for this run.
  const ocr: HelperHandler = async (message, send, payload) => {
    if (message.type !== "ocr") { throw new Error(`ocr handler received ${message.type}`); }
    const { id } = message;
    const png = payload ?? new Uint8Array();
    if (png.length > MAX_OCR_PNG_BYTES) { failed(send, id, "limit", "The equation image is too large to read through LabShelf Helper."); return; }
    const controller = new AbortController();
    running.set(id, controller);
    try {
      if (!(await runner.find())) {
        failed(send, id, "missing", NOT_INSTALLED);
        return;
      }
      if (controller.signal.aborted) { failed(send, id, "failed", "Cancelled."); return; }
      const outcome = await runner.read(png, controller.signal).then((latex) => ({ latex }), (error: unknown) => ({ error }));
      if (controller.signal.aborted) { failed(send, id, "failed", "Cancelled."); return; }
      if ("error" in outcome) { failed(send, id, "failed", formatError(outcome.error)); return; }
      send({ v: PROTOCOL_VERSION, id, type: "ocrResult", latex: outcome.latex });
    } finally {
      running.delete(id);
    }
  };
  const cancelOcr: HelperHandler = async (message) => {
    if (message.type !== "cancelOcr") { throw new Error(`cancelOcr handler received ${message.type}`); }
    running.get(message.requestId)?.abort();
  };
  const installPix2tex: HelperHandler = async (message, send) => {
    if (message.type !== "installPix2tex") { throw new Error(`installPix2tex handler received ${message.type}`); }
    const { id } = message;
    const onProgress = (_text: string, fraction?: number) =>
      send({ v: PROTOCOL_VERSION, id, type: "progress", phase: "python", message: "Installing pix2tex", ...(fraction === undefined ? {} : { fraction }) });
    try {
      await provider.install(onProgress);
      send({ v: PROTOCOL_VERSION, id, type: "ready", protocol: PROTOCOL_VERSION, ...(await deps.readyFields()), capabilities: [...HELPER_CAPABILITIES] });
    } catch (error) {
      await logger.error(MODULE, error, { step: "pix2tex", id });
      send({ v: PROTOCOL_VERSION, id, type: "error", code: "pix2tex-install-failed", message: formatError(error) });
    }
  };
  return { ocr, cancelOcr, installPix2tex };
}
