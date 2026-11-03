/** @jest-environment jsdom */
import { sanitizeDrawingSvg } from "../../../src/qmd/dom/drawingSanitize";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const wrap = (inner: string, rootAttrs = "") => `<svg ${NS} width="10" height="10" viewBox="0 0 10 10"${rootAttrs}>${inner}</svg>`;

const ALLOWED = wrap(
  '<title>Drawing</title><defs><path id="h" d="M0 0L2 1L0 2Z"/></defs>' +
    '<g stroke="currentColor" fill="none" stroke-width="0.8" transform="translate(1 1)">' +
    '<path d="M1 1L9 9"/><line x1="0" y1="0" x2="5" y2="5"/><circle cx="5" cy="5" r="2"/><rect x="1" y="1" width="3" height="3"/>' +
    '<polygon points="0,0 4,0 2,3"/><polyline points="0,0 4,0 2,3"/><use href="#h" transform="translate(3 3)"/></g>',
);

describe("A4 sanitizeDrawingSvg: allowed markup", () => {
  it("A4 keeps markup that uses only the allowlist", () => {
    const out = sanitizeDrawingSvg(ALLOWED);
    expect(out).not.toBeNull();
    for (const tag of ["<title", "<defs", "<path", "<line", "<circle", "<rect", "<polygon", "<polyline", "<use"]) expect(out).toContain(tag);
    expect(out).toContain('d="M1 1L9 9"');
    expect(out).toContain('href="#h"');
  });

  it("A4 keeps a local xlink:href on use", () => {
    const out = sanitizeDrawingSvg(wrap('<defs><path id="h" d="M0 0L1 1"/></defs><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#h"/>'));
    expect(out).not.toBeNull();
  });
});

describe("A4 sanitizeDrawingSvg: hostile markup returns null, never a cleaned copy", () => {
  const cases: Array<[string, string]> = [
    ["a script element", wrap('<script>alert(1)</script><path d="M0 0L1 1"/>')],
    ["a foreignObject", wrap('<foreignObject width="5" height="5"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>')],
    ["an onload attribute on the root", wrap('<path d="M0 0L1 1"/>', ' onload="alert(1)"')],
    ["an onclick attribute on a path", wrap('<path d="M0 0L1 1" onclick="alert(1)"/>')],
    ["an onLoad attribute in mixed case", wrap('<path d="M0 0L1 1" onLoad="alert(1)"/>')],
    ["a style attribute", wrap('<path d="M0 0L1 1" style="fill:red"/>')],
    ["a style attribute on the root", wrap('<path d="M0 0L1 1"/>', ' style="color:red"')],
    ["a style element", wrap("<style>path{fill:red}</style><path d=\"M0 0L1 1\"/>")],
    ["an external href on use", wrap('<use href="https://evil.example/x.svg#a"/>')],
    ["a protocol-relative href on use", wrap('<use href="//evil.example/x.svg#a"/>')],
    ["a data href on use", wrap('<use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>')],
    ["a javascript href on use", wrap('<use href="javascript:alert(1)"/>')],
    ["a file href with a fragment on use", wrap('<use href="x.svg#a"/>')],
    ["an external xlink:href on use", wrap('<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://evil.example/x.svg#a"/>')],
    ["an image element", wrap('<image href="https://evil.example/x.png" width="5" height="5"/>')],
    ["an anchor element", wrap('<a href="https://evil.example"><path d="M0 0L1 1"/></a>')],
    ["an animation element", wrap('<path d="M0 0L1 1"><animate attributeName="d" to="M0 0L9 9"/></path>')],
    ["a script nested in a group", wrap('<g><g><script>alert(1)</script></g></g>')],
    ["an event attribute on a nested element", wrap('<g><g><circle cx="1" cy="1" r="1" onmouseover="alert(1)"/></g></g>')],
  ];

  it.each(cases)("A4 rejects %s", (_name, markup) => {
    expect(sanitizeDrawingSvg(markup)).toBeNull();
  });

  it("A4 rejects an empty string", () => {
    expect(sanitizeDrawingSvg("")).toBeNull();
  });

  it("A4 rejects markup whose root is not an svg", () => {
    expect(sanitizeDrawingSvg("<div>hello</div>")).toBeNull();
    expect(sanitizeDrawingSvg("just text")).toBeNull();
  });

  it("A4 rejects malformed markup", () => {
    expect(sanitizeDrawingSvg(`<svg ${NS}><path d="M0 0"></svg>`)).toBeNull();
  });
});
