// `plan prompt <session> <id>`: renders the implementer prompt for a spec.
import { stringify } from "yaml";
import { findSpec, loadPlan } from "./planFiles.mjs";

/** Returns the prompt text: 3-line header, the spec as a ```yaml spec/v1 block, and `Return report/v1.` as the last line. */
export function planPrompt(_root, { planDir, sessionId, specId }) {
  const spec = findSpec(planDir, sessionId, specId);
  const { slug } = loadPlan(planDir);
  const body = stringify({ schema: "spec/v1", ...spec }, { lineWidth: 0 });
  return [
    `Plan ${slug}, session ${sessionId}.`,
    `Spec ${spec.id}: ${spec.goal}`,
    "Edit only spec paths; tests are hidden.",
    "",
    "```yaml spec/v1",
    body.trimEnd(),
    "```",
    "",
    "Return report/v1.",
  ].join("\n");
}
