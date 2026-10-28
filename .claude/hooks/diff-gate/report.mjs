// Formats violations for the agent (compact block reason) and counts them for the log.
const MAX_REASON = 1500;

export function countByKind(violations) {
  const counts = {};
  for (const violation of violations) counts[violation.kind] = (counts[violation.kind] ?? 0) + 1;
  return counts;
}

function describe(violation) {
  const where = violation.file + (violation.line ? `:${violation.line}` : "");
  const fix = violation.kind === "source-rule" || !violation.fix ? "" : ` -> ${violation.fix}`;
  return `- ${where} ${violation.message}${fix}`;
}

export function formatReason(violations) {
  const head = `Diff gate: your changes in this session introduce ${violations.length} problem${violations.length === 1 ? "" : "s"}. Fix them before finishing:`;
  const lines = [];
  let length = head.length;
  for (const [index, violation] of violations.entries()) {
    let line = describe(violation);
    if (line.length > 280) line = `${line.slice(0, 277)}...`;
    const remaining = violations.length - index;
    const tail = `\n- ... and ${remaining - 1} more`;
    if (length + line.length + 1 + (remaining > 1 ? tail.length : 0) > MAX_REASON) {
      lines.push(`- ... and ${remaining} more (run the gate CLI for the full list)`);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return [head, ...lines].join("\n");
}

// Stable identity of a violation across line shifts, used to notify once per session.
export function violationKey(violation) {
  return [violation.kind, violation.file, violation.symbol ?? violation.annotation?.ruleClass ?? violation.message ?? ""].join("|");
}

const MAX_NOTICE_LINES = 8;

// Compact text for the user (systemMessage): a heading plus at most MAX_NOTICE_LINES - 1 lines, "+N more" when cut.
export function formatNotice(violations) {
  const head = `Diff gate notes (${violations.length}, not blocking):`;
  const room = MAX_NOTICE_LINES - 1;
  const shown = violations.length > room ? room - 1 : violations.length;
  const lines = violations.slice(0, shown).map((violation) => {
    const line = describe(violation).replace(/\s+/g, " ");
    return line.length > 160 ? `${line.slice(0, 157)}...` : line;
  });
  if (shown < violations.length) lines.push(`+${violations.length - shown} more`);
  return [head, ...lines].join("\n");
}
