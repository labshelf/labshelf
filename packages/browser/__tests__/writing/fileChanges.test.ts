// A project file written in another page (the reader's cite popup) reaches the source tab of that file: it reloads, or warns when its unsaved edits overlap the change.
import { followProjectFileChanges, onProjectFileChange, sendProjectFileChange } from "../../src/writing/fileChanges";
import { registerOpenEditor } from "../../src/writing/session";

const delivered = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("project file changes across pages", () => {
  it("delivers well-formed changes and ignores other messages on the channel", async () => {
    const heard: unknown[] = [];
    const stop = onProjectFileChange((change) => heard.push(change));
    const stranger = new BroadcastChannel("labshelf-file-changed");
    stranger.postMessage({ path: 3 });
    stranger.postMessage("changed");
    stranger.close();
    sendProjectFileChange({ projectId: "thesis", path: "main.tex" });
    await delivered();
    stop();
    expect(heard).toEqual([{ projectId: "thesis", path: "main.tex" }]);
  });

  it("reloads the open editor of the changed file only, and warns when it could not take the change", async () => {
    const reloads: string[] = [];
    let merged = true;
    const editor = (path: string) => ({ revealLine: () => undefined, flush: async () => true, reload: async () => { reloads.push(path); return merged; } });
    const unregister = [registerOpenEditor("thesis", "main.tex", editor("main.tex")), registerOpenEditor("thesis", "intro.tex", editor("intro.tex"))];
    const conflicts: string[] = [];
    const stop = followProjectFileChanges({ projectId: "thesis", path: "main.tex" }, () => conflicts.push("main.tex"));
    sendProjectFileChange({ projectId: "thesis", path: "intro.tex" });
    sendProjectFileChange({ projectId: "other", path: "main.tex" });
    sendProjectFileChange({ projectId: "thesis", path: "main.tex" });
    await delivered();
    expect(reloads).toEqual(["main.tex"]);
    expect(conflicts).toEqual([]);
    merged = false;
    sendProjectFileChange({ projectId: "thesis", path: "main.tex" });
    await delivered();
    expect(conflicts).toEqual(["main.tex"]);
    stop();
    for (const off of unregister) off();
  });
});
