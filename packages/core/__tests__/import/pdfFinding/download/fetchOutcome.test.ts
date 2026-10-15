/** Contract of the fetch classifier: each hop ends as a PDF, a bot check, a login or paywall, plain HTML or an error. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyFetch } from "../../../../src/import/pdfFinding/download/fetchOutcome";
import { PDF } from "../../../support/pdfFindingHarness";

const fixture = (name: string): string => readFileSync(join(__dirname, "..", "..", "..", "fixtures", name), "utf8");
const finalUrl = "https://publisher.example/doi/10.1/x";
const challenge = "<title>Just a moment...</title><body>cf_chl_opt</body>";

describe("classifyFetch", () => {
  it("calls a body that starts with %PDF a pdf", () => {
    expect(classifyFetch({ status: 200, finalUrl, bytes: PDF })).toBe("pdf");
  });

  it("calls a Cloudflare challenge a bot check, whatever else the page says", () => {
    expect(classifyFetch({ status: 403, finalUrl, html: challenge })).toBe("bot");
    expect(classifyFetch({ status: 503, finalUrl, html: `${challenge}<input type="password">` })).toBe("bot");
  });

  it("keeps the bot check's status gating: the same words on a 200 page are no bot check", () => {
    expect(classifyFetch({ status: 200, finalUrl, html: challenge })).not.toBe("bot");
  });

  it("calls a 401 or a bare 403 a login", () => {
    expect(classifyFetch({ status: 401, finalUrl, html: "" })).toBe("login");
    expect(classifyFetch({ status: 403, finalUrl, html: "<title>Forbidden</title>" })).toBe("login");
  });

  it("calls an HTML page with a password form and no PDF a login", () => {
    expect(classifyFetch({ status: 200, finalUrl, html: fixture("loginWall.html") })).toBe("login");
  });

  it.each(["Sign in to continue", "Access through your institution", "Purchase this article", "GET ACCESS"])(
    "calls a page that says %p and offers no PDF a login",
    (words) => {
      expect(classifyFetch({ status: 200, finalUrl, html: `<body><button>${words}</button></body>` })).toBe("login");
    },
  );

  it("ignores login words inside styles and scripts", () => {
    const page = "<style>.purchase{}</style><script>var t='Sign in'</script><body>Abstract only</body>";
    expect(classifyFetch({ status: 200, finalUrl, html: page })).toBe("html");
  });

  it("calls a page that offers a PDF html, even when it also says Sign in", () => {
    const page = '<head><meta name="citation_pdf_url" content="https://cdn.example/full.pdf"></head><body><a>Sign in</a></body>';
    expect(classifyFetch({ status: 200, finalUrl, html: page })).toBe("html");
  });

  it("calls any other HTML page html", () => {
    expect(classifyFetch({ status: 200, finalUrl, html: "<body>Abstract and references</body>" })).toBe("html");
  });

  it("calls other failures and bodies that are neither HTML nor PDF an error", () => {
    expect(classifyFetch({ status: 404, finalUrl, html: "not found" })).toBe("error");
    expect(classifyFetch({ status: 500, finalUrl, html: "oops" })).toBe("error");
    expect(classifyFetch({ status: 200, finalUrl, bytes: new Uint8Array([1, 2, 3]) })).toBe("error");
  });
});
