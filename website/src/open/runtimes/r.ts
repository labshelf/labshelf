// An R cell session in the browser: WebR from its official CDN, loaded on the first run; a cancel closes its worker.
import type { CellRequest } from "@labshelf/core";

import { deriveRParamCode } from "./cellResult.js";
import type { CellSession } from "./cells.js";

// INVARIANT: the WebR release every /open/ page loads.
const WEBR_VERSION = "0.6.1";

const WEBR_BASE_URL = `https://webr.r-wasm.org/v${WEBR_VERSION}/`;

// The part of WebR's API a session uses; the module comes from the CDN, so its types are not in the bundle.
interface RCondition { get(name: string): Promise<{ toString(): Promise<string> }> }
interface WebRShelter {
  captureR(code: string, options: Record<string, unknown>): Promise<{ output: { type: string; data: string | RCondition }[]; images: ImageBitmap[] }>;
  purge(): Promise<void>;
}
interface WebRInstance {
  init(): Promise<unknown>;
  close(): void;
  Shelter: new () => Promise<WebRShelter>;
}
interface WebRModule { WebR: new (options: { baseUrl: string; interactive?: boolean }) => WebRInstance }

const PLOT_SIZE = 504;

const conditionMessage = async (condition: RCondition): Promise<string> => (await condition.get("message")).toString();

async function pngDataUrl(image: ImageBitmap): Promise<string> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext("2d")?.drawImage(image, 0, 0);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) { binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000)); }
  return `data:image/png;base64,${btoa(binary)}`;
}

/** @returns an R session whose WebR starts on the first run; dispose closes it, mid-run included. */
export function createRSession(): CellSession {
  let webR: Promise<WebRInstance> | undefined;
  let closed = false;

  async function load(): Promise<WebRInstance> {
    const url = `${WEBR_BASE_URL}webr.mjs`;
    let module: WebRModule;
    try { module = await import(/* webpackIgnore: true */ url) as WebRModule; }
    catch (error) { throw new Error(`R could not load in your browser: ${error instanceof Error ? error.message : String(error)}`); }
    const instance = new module.WebR({ baseUrl: WEBR_BASE_URL, interactive: false });
    await instance.init();
    if (closed) { instance.close(); }
    return instance;
  }

  return {
    async run(request: CellRequest) {
      webR ??= load();
      const instance = await webR;
      const shelter = await new instance.Shelter();
      try {
        const captured = await shelter.captureR(deriveRParamCode(request.params) + request.code, {
          withAutoprint: true,
          captureStreams: true,
          captureConditions: true,
          captureGraphics: { width: PLOT_SIZE, height: PLOT_SIZE },
        });
        const printed: string[] = [];
        const warnings: string[] = [];
        for (const { type, data } of captured.output) {
          const text = typeof data === "string" ? data : await conditionMessage(data);
          if (type === "warning") { warnings.push(`Warning: ${text}`); } else { printed.push(text.replace(/\n$/, "")); }
        }
        const image = captured.images.at(-1);
        return { printed: printed.join("\n"), ...(image ? { text: await pngDataUrl(image) } : {}), ...(warnings.length > 0 ? { warnings } : {}) };
      } catch (error) {
        // A cell's own error arrives as an exception naming WebR's eval wrapper as the call, which says nothing to the reader.
        const message = error instanceof Error ? error.message : String(error);
        return { printed: "", error: message.replace(/^Error in `eval\(ei, envir\)`: /, "Error: ") };
      } finally {
        await shelter.purge().catch(() => undefined);
      }
    },
    dispose() {
      closed = true;
      void webR?.then((instance) => instance.close(), () => undefined);
      webR = undefined;
    },
  };
}
