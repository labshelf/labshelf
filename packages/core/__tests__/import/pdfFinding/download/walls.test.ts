/** Contract of the wall and login signatures: saved publisher answers classify as bot or login on any status. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isBotCheck } from "../../../../src/import/pdfFinding/download/botCheck";
import { classifyFetch } from "../../../../src/import/pdfFinding/download/fetchOutcome";

const fixture = (name: string): string => readFileSync(join(__dirname, "..", "..", "..", "fixtures", name), "utf8");
const finalUrl = "https://publisher.example/doi/pdf/10.1/x";

// Walls whose markers are specific enough to count on a 200 page: [fixture, the status the service answers with].
const SPECIFIC_WALLS: ReadonlyArray<readonly [string, number]> = [
  ["f5Fastly", 200],
  ["awsWaf", 403],
  ["anubis", 200],
  ["pmcProofOfWork", 200],
  ["imperva", 200],
  ["highwire", 403],
  ["mdpi", 403],
];

// Walls recognised by generic words, which count only with a challenge status.
const GENERIC_WALLS: ReadonlyArray<readonly [string, number]> = [
  ["cloudflare", 403],
  ["akamai", 403],
];

const LOGINS = ["springer", "sciencedirect", "wiley", "ieee", "shibbolethIdp"];

describe("wall signatures", () => {
  it.each(SPECIFIC_WALLS)("calls the %s wall a bot check on a 200 and on its own status", (name, status) => {
    const html = fixture(`walls/${name}.html`);
    expect(classifyFetch({ status: 200, finalUrl, html })).toBe("bot");
    expect(classifyFetch({ status, finalUrl, html })).toBe("bot");
  });

  it.each(GENERIC_WALLS)("calls the %s wall a bot check on its own status", (name, status) => {
    expect(classifyFetch({ status, finalUrl, html: fixture(`walls/${name}.html`) })).toBe("bot");
  });

  it("calls a Radware redirect a bot check from the final URL alone", () => {
    const radware = "https://validate.perfdrive.com/abc/?ssa=1&ssb=iopscience.iop.org";
    expect(classifyFetch({ status: 200, finalUrl: radware, html: "<body>Checking</body>" })).toBe("bot");
    expect(classifyFetch({ status: 200, finalUrl: "https://perfdrive.example/", html: "<body>Abstract</body>" })).toBe("html");
  });

  it("calls an AWS WAF challenge a bot check from its header alone, with an empty body", () => {
    const headers = new Headers({ "x-amzn-waf-action": "challenge" });
    expect(classifyFetch({ status: 202, finalUrl, html: "", headers })).toBe("bot");
    expect(classifyFetch({ status: 200, finalUrl, html: "<body>Abstract</body>", headers })).toBe("bot");
    expect(classifyFetch({ status: 200, finalUrl, html: "<body>Abstract</body>", headers: new Headers({ "x-amzn-waf-action": "allow" }) })).toBe("html");
  });

  it("calls a Cloudflare mitigation header a bot check on any status", () => {
    const headers = new Headers({ "cf-mitigated": "challenge" });
    expect(classifyFetch({ status: 200, finalUrl, html: "<body>Abstract</body>", headers })).toBe("bot");
  });

  it("counts the Imperva header only with a challenge status, since protected sites send it on every answer", () => {
    const headers = new Headers({ "x-iinfo": "1-7088676-0 0NNN RT(1 2)" });
    expect(classifyFetch({ status: 403, finalUrl, html: "", headers })).toBe("bot");
    expect(classifyFetch({ status: 200, finalUrl, html: "<body>Abstract and references</body>", headers })).toBe("html");
  });

  it("keeps generic words from flagging an ordinary page that only mentions them", () => {
    const page = "<body>Abstract and references<footer>Protected by Cloudflare. Solve the CAPTCHA to comment.</footer></body>";
    expect(isBotCheck(200, page)).toBe(false);
    expect(classifyFetch({ status: 200, finalUrl, html: page })).toBe("html");
  });

  it("still ranks a PDF above every wall marker", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n/_fs-ch-");
    expect(classifyFetch({ status: 200, finalUrl, bytes, headers: new Headers({ "x-amzn-waf-action": "challenge" }) })).toBe("pdf");
  });
});

describe("login pages", () => {
  it.each(LOGINS)("calls the saved %s login or paywall page a login", (name) => {
    expect(classifyFetch({ status: 200, finalUrl, html: fixture(`login/${name}.html`) })).toBe("login");
  });

  it("calls an article page html when it has a navbar Sign in link and offers a PDF", () => {
    const page = '<head><meta name="citation_pdf_url" content="https://cdn.example/full.pdf"></head><body><nav><a href="/login">Sign in</a></nav>Abstract</body>';
    expect(classifyFetch({ status: 200, finalUrl, html: page })).toBe("html");
  });

  it("does not take a wall page for a login, even with sign-in words in it", () => {
    expect(classifyFetch({ status: 200, finalUrl, html: `${fixture("walls/f5Fastly.html")}<a>Sign in</a>` })).toBe("bot");
  });
});
