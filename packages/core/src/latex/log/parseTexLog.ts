/** Lists the problems of a LaTeX build from its transcript, in plain language and in the order TeX met them. */

import type { LatexEngine } from "../../writing/project/index.js";
import { describeTexMessage, type BuildProblem } from "./describeTexMessage.js";
import { readTexLog, type TexLogMessage } from "./readTexLog.js";

// TeX follows a fatal error with these; they say only that the run stopped.
const AFTERMATH = /^(?:Emergency stop|==> Fatal error occurred|\*\*\* \(job aborted)/;

function key(problem: BuildProblem): string {
  return `${problem.file ?? ""}:${problem.line ?? ""}:${problem.severity}:${problem.message}`;
}

export function parseTexLog(log: string, engine: LatexEngine): BuildProblem[] {
  const messages = readTexLog(log);
  const hasCause = messages.some((message) => message.kind === "error" && !AFTERMATH.test(message.text));
  const kept = (message: TexLogMessage): boolean => !(hasCause && message.kind === "error" && AFTERMATH.test(message.text));
  const seen = new Set<string>();
  const problems: BuildProblem[] = [];
  for (const message of messages.filter(kept)) {
    const problem = describeTexMessage(message, engine);
    if (!problem || seen.has(key(problem))) { continue; }
    seen.add(key(problem));
    problems.push(problem);
  }
  return problems;
}
