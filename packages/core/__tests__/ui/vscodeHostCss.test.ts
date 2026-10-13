/**
 * Tests that the committed vscodeHost.css matches the host map and that every themed colour role is mapped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COLOR_TOKENS, STATUS_TOKENS, renderVscodeHostCss } from "@labshelf/core";

const HOST_CSS = join(__dirname, "../../src/ui/dom/vscodeHost.css");

// No VS Code variable stands for these, so VS Code uses the token value.
const UNMAPPED = ["overlay", "on-badge", "status-unread"];

describe("vscodeHost.css", () => {
  // `pnpm --filter @labshelf/core tokens` regenerates the file through this test.
  it("is the rendering of the host map", () => {
    if (process.env["WRITE_TOKENS"]) writeFileSync(HOST_CSS, renderVscodeHostCss());
    expect(readFileSync(HOST_CSS, "utf8")).toBe(renderVscodeHostCss());
  });

  it("maps every colour role VS Code has a variable for", () => {
    const css = renderVscodeHostCss();
    const roles = [...Object.keys(COLOR_TOKENS), ...Object.keys(STATUS_TOKENS)].filter((r) => !UNMAPPED.includes(r));
    for (const role of roles) expect(css).toMatch(new RegExp(`--ls-${role}: var\\(--vscode-`));
  });

  it("leaves status-unread on the blue role, which follows charts-blue", () => {
    expect(renderVscodeHostCss()).toContain("--ls-blue: var(--vscode-charts-blue);");
    expect(renderVscodeHostCss()).not.toContain("--ls-status-unread");
  });
});
