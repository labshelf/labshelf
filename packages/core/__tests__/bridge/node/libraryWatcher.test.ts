/** Pins the host's `changed` events: batched, relative to the root, without sync-tool noise. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";
import { startBridge } from "./bridgeHarness";

afterEach(cleanupTempDirs);

describe("changed events", () => {
  it("reports changes in the library as relative paths and skips noise", async () => {
    const root = path.join(await makeTempDir(), "library");
    await fs.mkdir(path.join(root, "papers", "a"), { recursive: true });
    const bridge = await startBridge(root);
    await bridge.hello();
    await fs.writeFile(path.join(root, "papers", "a", ".DS_Store"), "x");
    await fs.writeFile(path.join(root, "papers", "a", "metadata.yaml"), "title: x\n");
    const seen = new Set<string>();
    while (!seen.has("papers/a/metadata.yaml")) {
      const event = await bridge.next((m) => "event" in m);
      expect(event).toMatchObject({ event: "changed" });
      for (const changed of (event as { paths: string[] }).paths) { seen.add(changed); }
    }
    expect([...seen].some((changed) => changed.endsWith(".DS_Store"))).toBe(false);
    expect([...seen].every((changed) => !path.isAbsolute(changed) && !changed.includes("\\"))).toBe(true);
    await bridge.close();
  });
});
