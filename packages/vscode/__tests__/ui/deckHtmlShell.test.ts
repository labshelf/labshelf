/** The deck shell writes the same document as the webview shell with its own policy for the srcdoc slide frame. */
import { renderDeckHtmlShell } from "../../src/ui/deckHtmlShell";
import { renderHtmlShell } from "../../src/ui/htmlShell";

const base = { nonce: "N", cspSource: "SRC", title: "T", stylesheetUrl: "css-url", scriptUrl: "js-url" };

const DECK_CSP = "default-src 'none'; script-src 'nonce-N' SRC; style-src SRC 'unsafe-inline'; img-src SRC data: blob:; font-src SRC data:; frame-src 'self' about: blob:;";

/** The Content-Security-Policy content of a rendered shell. */
function cspOf(html: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\/>/.exec(html);
  if (!match) throw new Error("no CSP meta in the shell");
  return match[1]!;
}

/** One directive of a policy, without its trailing semicolon. */
function directive(csp: string, name: string): string | undefined {
  return csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
}

describe("renderDeckHtmlShell", () => {
  it("8.1a builds the same document as the shell with the deck policy", () => {
    expect(renderDeckHtmlShell(base)).toBe(`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${DECK_CSP}"/>
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

  it("8.1a style-src carries no nonce and allows inline styles", () => {
    expect(directive(cspOf(renderDeckHtmlShell(base)), "style-src")).toBe("style-src SRC 'unsafe-inline'");
  });

  it("8.1a frame-src allows the srcdoc slide frame", () => {
    expect(directive(cspOf(renderDeckHtmlShell(base)), "frame-src")).toBe("frame-src 'self' about: blob:");
  });

  it("8.1a img-src and font-src allow data: and blob: as stated", () => {
    const csp = cspOf(renderDeckHtmlShell(base));
    expect(directive(csp, "img-src")).toBe("img-src SRC data: blob:");
    expect(directive(csp, "font-src")).toBe("font-src SRC data:");
  });

  it("8.1a scripts still need the nonce", () => {
    expect(directive(cspOf(renderDeckHtmlShell(base)), "script-src")).toBe("script-src 'nonce-N' SRC");
  });

  it("8.1a ignores images", () => {
    expect(renderDeckHtmlShell({ ...base, images: "data" })).toBe(renderDeckHtmlShell(base));
  });

  it("8.1a leaves renderHtmlShell's policy as it was", () => {
    const deckCsp = cspOf(renderDeckHtmlShell(base));
    const shellCsp = cspOf(renderHtmlShell(base));
    expect(deckCsp).not.toBe(shellCsp);
    expect(directive(deckCsp, "style-src")).not.toBe(directive(shellCsp, "style-src"));
    expect(shellCsp).toBe("default-src 'none'; script-src 'nonce-N' SRC; style-src 'nonce-N' SRC; font-src SRC;");
    expect(cspOf(renderHtmlShell({ ...base, images: "data" }))).toBe("default-src 'none'; script-src 'nonce-N' SRC; style-src 'nonce-N' SRC; img-src SRC data:; font-src SRC;");
  });
});
