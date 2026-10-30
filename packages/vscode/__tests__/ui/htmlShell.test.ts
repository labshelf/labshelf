/** The shell carries the nonce in the CSP and the script tag, and widens images only on request. */
import { renderHtmlShell } from "../../src/ui/htmlShell";

const base = { nonce: "N", cspSource: "SRC", title: "T", stylesheetUrl: "css-url", scriptUrl: "js-url" };

describe("renderHtmlShell", () => {
  it("builds the document with a nonce script policy that also loads extension module chunks", () => {
    expect(renderHtmlShell(base)).toBe(`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-N' SRC; style-src 'nonce-N' SRC; font-src SRC;"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>T</title>
<link rel="stylesheet" href="css-url"/>
</head>
<body>
<div id="root"></div>
<script nonce="N" type="module" src="js-url"></script>
</body>
</html>`);
  });

  it("allows data: images only when asked", () => {
    expect(renderHtmlShell(base)).not.toContain("img-src");
    expect(renderHtmlShell({ ...base, dataImages: true })).toContain("style-src 'nonce-N' SRC; img-src SRC data:; font-src SRC;");
  });
});
