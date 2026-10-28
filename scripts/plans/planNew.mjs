// `plan new <slug> --level N2|N3 [--title <t>]`: creates the plan skeleton under documents/plans/<slug>/.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { savePlan, saveSession } from "./planFiles.mjs";

export const LOG_HEADER = (title) =>
  `# Log: ${title}\n\n<!-- Append-only. One line per finished step or session: \`- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>\`. Add lines with \`>>\`; never read the file whole. A closed session adds one line with the peak context of the main thread and of the largest subagent. -->\n`;

/** Creates the plan folder (plan.yaml, sessions/1.yaml, log.md, research/) and returns its absolute path. Throws on bad input or an existing folder. */
export function planNew(root, { slug, level, title }) {
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error("plan new: <slug> must be lowercase words joined by '-' (e.g. agent-pipeline)");
  if (level !== "N2" && level !== "N3") throw new Error("plan new: --level must be N2 or N3");
  const dir = join(root, "documents", "plans", slug);
  if (existsSync(dir)) throw new Error(`plan new: documents/plans/${slug} already exists`);
  const planTitle = typeof title === "string" && title ? title : slug;
  savePlan(dir, {
    slug,
    title: planTitle,
    status: "draft",
    level,
    goal: "TODO",
    decisions: [],
    acceptance: [],
    sessions: [{ id: "1", file: "sessions/1.yaml", depends_on: [], owns: [] }],
  });
  saveSession(dir, { id: "1", goal: "TODO", depends_on: [], owns: [], status: "pending", packages: [] });
  mkdirSync(join(dir, "research"), { recursive: true });
  writeFileSync(join(dir, "log.md"), LOG_HEADER(planTitle));
  return dir;
}
