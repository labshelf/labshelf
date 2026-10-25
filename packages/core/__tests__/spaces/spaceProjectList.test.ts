// Tests that createSpaceProjectList maps project rows to Space project infos and survives checklist read failures.
import type { ILogger } from "../../src/ports/index";
import { createSpaceProjectList } from "../../src/spaces/index";
import type { ProjectRow } from "../../src/writing/allProjects/index";

const row = (over: Partial<ProjectRow> = {}): ProjectRow => ({ id: "proj", title: "Paper draft", place: "projects", ...over });

function recordingLogger() {
  const logs: Array<{ level: string; message: string; context?: Record<string, unknown> | undefined }> = [];
  const logger: ILogger = {
    log: async (level, _module, message, context) => { logs.push({ level, message, context }); },
    error: async (_module, error) => { logs.push({ level: "ERROR", message: String(error) }); },
  };
  return { logs, logger };
}

describe("createSpaceProjectList", () => {
  it("maps the row's title, format, main file, deadline and checklist", async () => {
    const { logger } = recordingLogger();
    const rows = [row({ format: "latex", main: "main.tex", target: { deadline: "2026-11-05" } })];
    const infos = await createSpaceProjectList(rows, async () => ({ done: 2, total: 5 }), logger);
    expect(infos).toEqual([{
      projectId: "proj", title: "Paper draft", format: "latex", mainFile: "main.tex", deadline: "2026-11-05",
      checklist: { done: 2, total: 5 }, available: true,
    }]);
  });

  it("marks trashed and broken projects unavailable", async () => {
    const { logger } = recordingLogger();
    const rows = [row({ id: "a", place: "trash" }), row({ id: "b", broken: "no labshelf.yaml" }), row({ id: "c", place: "archived" })];
    const infos = await createSpaceProjectList(rows, async () => undefined, logger);
    expect(infos.map((info) => [info.projectId, info.available])).toEqual([["a", false], ["b", false], ["c", true]]);
    expect(infos[0]).not.toHaveProperty("checklist");
  });

  it("logs a warning and omits the checklist when it cannot be read", async () => {
    const { logs, logger } = recordingLogger();
    const infos = await createSpaceProjectList([row()], async () => { throw new Error("EACCES"); }, logger);
    expect(infos).toEqual([{ projectId: "proj", title: "Paper draft", available: true }]);
    expect(logs).toContainEqual(expect.objectContaining({
      level: "WARN", context: expect.objectContaining({ projectId: "proj", error: "EACCES" }),
    }));
  });
});
