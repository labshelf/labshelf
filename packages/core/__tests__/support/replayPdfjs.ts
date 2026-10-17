/** Replays what real pdf.js reports for a PDF, because Jest cannot load pdf.js itself. */
import { execFileSync } from "node:child_process";
import * as path from "node:path";

import type { PdfjsLoader } from "../../src/import/index";

interface DumpPage {
  fnArray: number[];
  argsArray: unknown[];
  fonts: Record<string, unknown>;
  items: unknown[];
}

interface Dump {
  OPS: Record<string, number>;
  info: Record<string, unknown>;
  pages: DumpPage[];
}

/** A child process records what pdf.js reports and the loader replays it. */
export function replayLoader(pdf: string): { loader: PdfjsLoader; destroy: jest.Mock } {
  const dumpScript = path.join(__dirname, "..", "writing", "checks", "node", "pdfCheckDump.mjs");
  const dump = JSON.parse(execFileSync(process.execPath, [dumpScript, pdf], { encoding: "utf8" })) as Dump;
  const document = {
    numPages: dump.pages.length,
    getPage: async (number: number) => {
      const page = dump.pages[number - 1]!;
      return {
        getOperatorList: async () => ({ fnArray: page.fnArray, argsArray: page.argsArray }),
        getTextContent: async () => ({ items: page.items }),
        commonObjs: { has: (id: string) => id in page.fonts, get: (id: string) => page.fonts[id] },
      };
    },
    getMetadata: async () => ({ info: dump.info }),
  };
  const destroy = jest.fn(async () => undefined);
  const loader = {
    load: async () => ({ OPS: dump.OPS }),
    getDocument: async () => ({ promise: Promise.resolve(document), destroy }),
  } as unknown as PdfjsLoader;
  return { loader, destroy };
}
