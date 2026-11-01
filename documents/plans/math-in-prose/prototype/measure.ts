// Throwaway measurement for spec 1.4: runs each item of derivations.md through runMath on the real kernel and writes raw.json.
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { createCellSessions } from "../../../../packages/core/src/qmd/compute/node/cellSessions";
import { locateTool } from "../../../../packages/core/src/qmd/compute/node/locateTool";

const here = path.resolve(process.argv[2] ?? ".");
const nodeDir = path.resolve(here, "../../../../packages/core/src/qmd/compute/node");

async function main(): Promise<void> {
  const md = readFileSync(path.join(here, "derivations.md"), "utf8");
  const items = JSON.parse(/```json\n([\s\S]*?)```/.exec(md)![1]!) as Array<{ id: string; op: "eval" | "check" | "solve"; tex: string; expect: string; state?: string }>;
  const wolframscript = await locateTool("wolframscript");
  if (!wolframscript) throw new Error("no wolframscript");
  const runner = createCellSessions({
    launch: async (language) => (language === "mathematica" ? { command: wolframscript, args: ["-noprompt", "-script", path.join(nodeDir, "cellDriver.wl")], ready: true } : undefined),
    logger: { log: async () => {}, error: async () => {} },
  });
  const out = [];
  for (const item of items) {
    const result = await runner.runMath!({ noteKey: "prototype", op: item.op, tex: item.tex });
    out.push({ ...item, result });
    process.stdout.write(`${item.id} ${result.state} ${result.readAs ?? ""}\n`);
  }
  await runner.dispose();
  writeFileSync(path.join(here, process.argv[3] ?? "raw.json"), JSON.stringify(out, null, 2));
}

void main();
