/** A logger whose calls are jest mocks, for asserting what the gallery host logs. */
import type { ILogger } from "../../../../src/ports/index.js";

export function jestLogger(): { log: jest.Mock; error: jest.Mock } & ILogger {
  return { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
}
