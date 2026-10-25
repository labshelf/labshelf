// Validates publication requests and replies at the helper protocol boundary.
import { parseHelperMessage, PROTOCOL_VERSION } from "../../../src/helper/index";
const draft = { name: "Research", category: "article", license: "MIT", description: "Starter" };
const envelope = { v: PROTOCOL_VERSION, id: "1" };

it.each([
  { action: "open" }, { action: "check", draft }, { action: "submit", draft, token: "secret" },
])("round trips a $action request and drops undeclared fields", (request) => {
  const message = { ...envelope, type: "publishTemplate", projectId: "paper", ...request };
  expect(parseHelperMessage({ ...message, root: "/outside", files: ["secret"] }, "toHelper")).toEqual({ ok: true, message });
});

it.each([
  { projectId: "../outside", action: "open" },
  { projectId: "paper", action: "submit", draft },
  { projectId: "paper", action: "submit", draft, token: "" },
  { projectId: "paper", action: "check", draft: { ...draft, category: "invalid" } },
  { projectId: "paper", action: "check", draft: { ...draft, name: "x".repeat(20_001) } },
])("rejects malformed publication fields %#", (fields) => {
  expect(parseHelperMessage({ ...envelope, type: "publishTemplate", ...fields }, "toHelper").ok).toBe(false);
});

it("round trips thumbnail requests, failure messages and publication replies", () => {
  const request = { ...envelope, type: "templateThumbnail", requestId: "publication", error: "Rendering failed" };
  expect(parseHelperMessage(request, "toHelper")).toEqual({ ok: true, message: request });
  for (const message of [
    { ...envelope, type: "templatePreview" },
    { ...envelope, type: "templatePublish", done: true },
    { ...envelope, type: "templatePublish", done: false, event: { type: "publish.failed", error: "Build failed" } },
    { ...envelope, type: "templatePublish", done: false, event: { type: "publish.checks", running: false, checks: [{ id: "build", ok: false, message: "Missing engine" }] } },
  ]) expect(parseHelperMessage(message, "toPage")).toEqual({ ok: true, message });
});

it("rejects unknown nested events and invalid check results", () => {
  for (const event of [{ type: "source" }, { type: "publish.checks", running: false, checks: [{ id: "unknown", ok: true }] }]) {
    expect(parseHelperMessage({ ...envelope, type: "templatePublish", done: false, event }, "toPage").ok).toBe(false);
  }
});
