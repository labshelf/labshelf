// Builds the project infos a Spaces host reports from its project rows and a checklist reader.
import type { ILogger } from "../ports/index.js";
import type { ProjectRow } from "../writing/allProjects/index.js";
import type { Progress, SpaceProjectInfo } from "./viewModel/index.js";

const MODULE = "spaces/projects";

/** Reads a project's checklist; `undefined` when it has none. */
export type ChecklistReader = (row: ProjectRow) => Promise<Progress | undefined>;

export function buildSpaceProjectInfos(rows: readonly ProjectRow[], readChecklist: ChecklistReader, logger: ILogger): Promise<SpaceProjectInfo[]> {
  return Promise.all(rows.map((row) => toInfo(row, readChecklist, logger)));
}

async function toInfo(row: ProjectRow, readChecklist: ChecklistReader, logger: ILogger): Promise<SpaceProjectInfo> {
  const available = row.place !== "trash" && row.broken === undefined;
  const checklist = available ? await readSafely(row, readChecklist, logger) : undefined;
  return {
    projectId: row.id,
    title: row.title,
    ...(row.format !== undefined ? { format: row.format } : {}),
    ...(row.main !== undefined ? { mainFile: row.main } : {}),
    ...(row.target?.deadline !== undefined ? { deadline: row.target.deadline } : {}),
    ...(checklist !== undefined ? { checklist } : {}),
    available,
  };
}

async function readSafely(row: ProjectRow, readChecklist: ChecklistReader, logger: ILogger): Promise<Progress | undefined> {
  try {
    return await readChecklist(row);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    void logger.log("WARN", MODULE, "Project checklist unreadable; shown without it", { projectId: row.id, error: reason });
    return undefined;
  }
}
