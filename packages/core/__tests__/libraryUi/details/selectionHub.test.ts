// Tests the selection hub: each source keeps its own last target, and activating a source shows it again.
import { createSelectionHub, type DetailsTarget } from "../../../src/libraryUi/details/index";

function hubWithLog() {
  const shown: DetailsTarget[] = [];
  return { shown, hub: createSelectionHub((t) => { shown.push(t); }) };
}

describe("createSelectionHub", () => {
  it("shows a published target at once", () => {
    const { shown, hub } = hubWithLog();
    hub.publish("library", { kind: "paper", ids: ["p1"] });
    expect(shown).toEqual([{ kind: "paper", ids: ["p1"] }]);
  });

  it("restores each source's own last target on activate", () => {
    const { shown, hub } = hubWithLog();
    hub.publish("library", { kind: "paper", ids: ["p1"] });
    hub.publish("library", { kind: "paper", ids: ["p2", "p3"] });
    hub.publish("projects", { kind: "project", id: "x" });
    shown.length = 0;
    hub.activate("library");
    hub.activate("projects");
    expect(shown).toEqual([{ kind: "paper", ids: ["p2", "p3"] }, { kind: "project", id: "x" }]);
  });

  it("does nothing when the activated source has published nothing", () => {
    const { shown, hub } = hubWithLog();
    hub.publish("library", { kind: "paper", ids: ["p1"] });
    shown.length = 0;
    hub.activate("projects");
    expect(shown).toEqual([]);
    expect(hub.current()).toEqual({ kind: "paper", ids: ["p1"] });
  });

  it("restores a published null as a target of its own", () => {
    const { shown, hub } = hubWithLog();
    hub.publish("projects", null);
    hub.publish("library", { kind: "paper", ids: ["p1"] });
    shown.length = 0;
    hub.activate("projects");
    expect(shown).toEqual([null]);
  });

  it("reports the last target shown, null before any", () => {
    const { hub } = hubWithLog();
    expect(hub.current()).toBeNull();
    hub.publish("library", { kind: "paper", ids: ["p1"] });
    hub.publish("projects", { kind: "project", id: "x" });
    expect(hub.current()).toEqual({ kind: "project", id: "x" });
    hub.activate("library");
    expect(hub.current()).toEqual({ kind: "paper", ids: ["p1"] });
  });
});
