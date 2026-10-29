// Answers the page's request to install the managed Python, modelled on the TeX install handlers.
// CONTRACT: documents/contracts/helper.md#messages
import { formatError } from "../../errors/index.js";
import type { ILogger } from "../../ports/index.js";
import type { PythonProvider } from "../../qmd/compute/node/index.js";
import { PROTOCOL_VERSION, type HelperHost, type TexToolchain } from "../helperMessages.js";
import type { HelperHandler } from "./helperHandlers.js";

const MODULE = "helper-python";

export interface PythonHandlersOptions { python: PythonProvider; texStatus(): Promise<TexToolchain>; helperVersion: string; host: HelperHost; logger: ILogger }

export function createPythonHandlers(options: PythonHandlersOptions): { installPython: HelperHandler } {
  const { python, logger } = options;
  const installPython: HelperHandler = async (message, send) => {
    if (message.type !== "installPython") { throw new Error(`installPython handler received ${message.type}`); }
    const { id } = message;
    const onProgress = (_text: string, fraction?: number) =>
      send({ v: PROTOCOL_VERSION, id, type: "progress", phase: "python", message: "Installing Python", ...(fraction === undefined ? {} : { fraction }) });
    try {
      const status = await python.install(onProgress);
      send({
        v: PROTOCOL_VERSION, id, type: "ready", protocol: PROTOCOL_VERSION, helperVersion: options.helperVersion, host: options.host,
        tex: await options.texStatus(), python: status.state,
      });
    } catch (error) {
      await logger.error(MODULE, error, { step: "python", id });
      send({ v: PROTOCOL_VERSION, id, type: "error", code: "python-install-failed", message: formatError(error) });
    }
  };
  return { installPython };
}
