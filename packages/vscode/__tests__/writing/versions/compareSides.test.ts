// Tests the side picker of Compare Versions: both picks, and a preset base that skips the first one.
import * as vscode from "vscode";

import type { ProjectVersion } from "@labshelf/core";
import { pickSides } from "../../../src/writing/versions/compareSides";

const quickPick = (vscode.window as unknown as Record<string, jest.Mock>)["showQuickPick"]!;

function version(slug: string): ProjectVersion {
  return { slug, name: slug, created: "2026-01-01T00:00:00Z", pdfPath: `/p/${slug}.pdf`, sourcesDir: `/p/${slug}/sources` };
}
const A = version("a");
const B = version("b");
const C = version("c");

function picks(...labels: string[]): void {
  const queue = [...labels];
  quickPick.mockImplementation(async (items: Array<{ label: string }>) => {
    const label = queue.shift();
    return items.find((item) => item.label === label);
  });
}

const labels = (call: number): string[] => quickPick.mock.calls[call]![0].map((item: { label: string }) => item.label);

beforeEach(() => jest.clearAllMocks());

describe("pickSides", () => {
  it("asks for the base, then the other side, and returns both", async () => {
    picks("a", "c");
    expect(await pickSides([A, B, C])).toEqual({ base: A, other: C });
    expect(quickPick).toHaveBeenCalledTimes(2);
    expect(labels(1)).toEqual(["Current build", "b", "c"]);
  });

  it("returns an undefined other side for the current build", async () => {
    picks("a", "Current build");
    expect(await pickSides([A, B])).toEqual({ base: A, other: undefined });
  });

  it("returns undefined when the first pick is cancelled", async () => {
    picks();
    expect(await pickSides([A, B])).toBeUndefined();
  });

  it("skips the first pick when a base is given and shows only the other pick without the base", async () => {
    picks("c");
    expect(await pickSides([A, B, C], B)).toEqual({ base: B, other: C });
    expect(quickPick).toHaveBeenCalledTimes(1);
    expect(labels(0)).toEqual(["Current build", "a", "c"]);
  });

  it("returns undefined when the only pick is cancelled with a base given", async () => {
    picks();
    expect(await pickSides([A, B], A)).toBeUndefined();
    expect(quickPick).toHaveBeenCalledTimes(1);
  });
});
