// Feeds every frame from the input stream to the dispatcher until EOF, then waits for the handlers to finish.
import type { ILogger } from "@labshelf/core";

import { readFrames } from "../stdio/index.js";
import type { Dispatcher } from "./dispatcher.js";

const LOG_MODULE = "helper-loop";

/** Resolves at EOF; rejects when the stream is corrupt (a frame past the size cap), after logging it. */
export async function runHelperLoop(input: AsyncIterable<Uint8Array>, dispatcher: Dispatcher, logger: ILogger): Promise<void> {
  try {
    for await (const frame of readFrames(input, {
      onTruncated: (bytes) => void logger.log("WARN", LOG_MODULE, "Input ended inside a frame", { bytes }),
    })) {
      dispatcher.accept(frame);
    }
  } catch (error) {
    await logger.error(LOG_MODULE, error);
    throw error;
  } finally {
    await dispatcher.drain();
  }
}
