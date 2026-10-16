// Pins the Publish screen's host: checks, sign-in, the pull request and every failure path (logged, posted and noticed).
import type { HostToGallery, PublishDraft } from "@labshelf/core";
import type { PublishCheckReport } from "@labshelf/core/node";
import { createPublishHost } from "../../../../src/writing/templates/publish/publishHost.js";
import type { PublishableProject, PublishPorts } from "../../../../src/writing/templates/publish/types.js";
import { fakeLogger } from "../../../support/writingFixtures.js";

const project: PublishableProject = {
  id: "thesis", title: "My thesis", folder: "/lib/projects/thesis", engineLabel: "pdfLaTeX",
  format: "latex", engine: "pdflatex", main: "main.tex",
};
const page = { id: "thesis", title: "My thesis", engineLabel: "pdfLaTeX" };
const draft: PublishDraft = { name: "My thesis", category: "thesis", license: "MIT", description: "d" };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1]);

const passing = (): PublishCheckReport => ({
  ok: true,
  checks: (["manifest", "license", "paths", "latexmkrc", "sizes", "build", "thumbnail"] as const).map((id) => ({ id, ok: true })),
  files: [
    { path: "template.yaml", bytes: new TextEncoder().encode("placeholder") },
    { path: "files/main.tex", bytes: Uint8Array.from([1]) },
  ],
  thumbnail: PNG, sample: Uint8Array.from([2]),
});
const failing = (): PublishCheckReport => ({ ok: false, checks: [{ id: "license", ok: false, message: "License is not valid." }] });

class FakeGitHubError extends Error {
  constructor(readonly step: string, readonly status: number) { super(`GitHub failed at the ${step} step`); }
}

function setup(over: Partial<PublishPorts> = {}) {
  const posts: HostToGallery[] = [];
  const logger = fakeLogger();
  const ports: PublishPorts = {
    logger,
    post: (m) => { posts.push(m); },
    auth: { signIn: jest.fn(async () => ({ token: "tok", login: "octocat" })) },
    projects: { pick: jest.fn(async () => project), byId: jest.fn(async (id: string) => (id === project.id ? project : undefined)) },
    buildPdf: jest.fn(async () => ({ ok: true as const, pdf: Uint8Array.from([2]) })),
    renderThumbnail: jest.fn(async () => PNG),
    check: jest.fn(async () => passing()),
    submit: jest.fn(async () => ({ url: "https://github.com/labshelf/labshelf-templates/pull/7", branch: "b" })),
    saveToMyTemplates: jest.fn(async () => {}),
    ...over,
  };
  return { host: createPublishHost(ports), ports, posts, logger };
}
const ofType = <T extends HostToGallery["type"]>(posts: HostToGallery[], type: T) =>
  posts.filter((p): p is Extract<HostToGallery, { type: T }> => p.type === type);
const errorNotices = (posts: HostToGallery[]) => ofType(posts, "notice").filter((n) => n.kind === "error");

describe("createPublishHost: opening", () => {
  it("opens the given project with a draft named after it", async () => {
    const { host, posts, ports } = setup();
    await host.open("thesis");
    expect(ports.projects.pick).not.toHaveBeenCalled();
    expect(posts).toEqual([{ type: "publish.open", project: page, draft: expect.objectContaining({ name: "My thesis" }) }]);
  });

  it("publish.start asks the user to pick; a cancelled pick posts nothing", async () => {
    const { host, posts, ports } = setup();
    await host.handle({ type: "publish.start" });
    expect(posts).toEqual([expect.objectContaining({ type: "publish.open", project: page })]);
    (ports.projects.pick as jest.Mock).mockResolvedValueOnce(undefined);
    await host.handle({ type: "publish.start" });
    expect(posts).toHaveLength(1);
  });

  it("logs and notices a project id that no longer exists", async () => {
    const { host, posts, logger } = setup();
    await host.open("gone");
    expect(logger.error).toHaveBeenCalledWith("writing/templates", expect.any(Error), expect.objectContaining({ step: "open", projectId: "gone" }));
    expect(errorNotices(posts)).toHaveLength(1);
  });
});

describe("createPublishHost: checks", () => {
  it("posts running checks first, then the final results with the thumbnail", async () => {
    const { host, posts, ports } = setup();
    await host.handle({ type: "publish.check", project: page, draft });
    const checks = ofType(posts, "publish.checks");
    expect(checks[0]).toMatchObject({ running: true });
    expect(checks[0]?.checks.every((c) => c.ok === undefined)).toBe(true);
    expect(checks[1]).toMatchObject({ running: false, thumbnail: expect.stringMatching(/^data:image\/png;base64,/) });
    expect(checks[1]?.checks.every((c) => c.ok === true)).toBe(true);
    expect(ports.check).toHaveBeenCalledWith(expect.objectContaining({
      projectFolder: project.folder, manifest: expect.objectContaining({ id: "my-thesis", engine: "pdflatex" }),
    }));
  });

  it("posts failed results without a thumbnail", async () => {
    const { host, posts } = setup({ check: jest.fn(async () => failing()) });
    await host.handle({ type: "publish.check", project: page, draft });
    expect(ofType(posts, "publish.checks")[1]).toEqual({
      type: "publish.checks", running: false, checks: [{ id: "license", ok: false, message: "License is not valid." }],
    });
  });

  it("reports an invalid draft as publish.failed and logs it", async () => {
    const { host, posts, ports, logger } = setup();
    await host.handle({ type: "publish.check", project: page, draft: { ...draft, category: "memo" } });
    expect(ports.check).not.toHaveBeenCalled();
    expect(ofType(posts, "publish.failed")).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith("writing/templates", expect.any(Error), expect.objectContaining({ step: "check", projectId: "thesis" }));
  });
});

describe("createPublishHost: sign-in", () => {
  it("posts the login", async () => {
    const { host, posts } = setup();
    await host.handle({ type: "publish.signIn" });
    expect(posts).toEqual([{ type: "publish.auth", login: "octocat" }]);
  });

  it("a refused sign-in posts publish.auth with the error, logs it and shows a notice (A6)", async () => {
    const { host, posts, logger } = setup({ auth: { signIn: jest.fn(async () => { throw new Error("User did not consent to login."); }) } });
    await host.handle({ type: "publish.signIn" });
    expect(ofType(posts, "publish.auth")).toEqual([{ type: "publish.auth", error: "User did not consent to login." }]);
    expect(logger.error).toHaveBeenCalledWith("writing/templates", expect.any(Error), expect.objectContaining({ step: "signIn" }));
    expect(errorNotices(posts)).toHaveLength(1);
  });
});

describe("createPublishHost: submit", () => {
  async function signedIn(over: Partial<PublishPorts> = {}) {
    const s = setup(over);
    await s.host.handle({ type: "publish.signIn" });
    s.posts.length = 0;
    return s;
  }

  it("opens the pull request with the login as author, then saves to My templates", async () => {
    const { host, posts, ports } = await signedIn();
    await host.handle({ type: "publish.check", project: page, draft });
    posts.length = 0;
    await host.handle({ type: "publish.submit", project: page, draft });
    expect(ports.check).toHaveBeenCalledTimes(1);
    expect(ports.submit).toHaveBeenCalledWith(expect.objectContaining({
      token: "tok", upstream: { owner: "labshelf", repo: "labshelf-templates" }, templateId: "my-thesis",
      files: expect.arrayContaining([expect.objectContaining({ path: "files/main.tex" })]),
    }));
    const yaml = (ports.submit as jest.Mock).mock.calls[0][0].files.find((f: { path: string }) => f.path === "template.yaml");
    expect(new TextDecoder().decode(yaml.bytes)).toContain("octocat");
    expect(ports.saveToMyTemplates).toHaveBeenCalledWith(project, expect.objectContaining({ authors: ["octocat"] }));
    expect(ofType(posts, "publish.submitted")).toEqual([{ type: "publish.submitted", url: "https://github.com/labshelf/labshelf-templates/pull/7" }]);
    expect(errorNotices(posts)).toHaveLength(0);
  });

  it("a failed pull request posts publish.failed, logs the step and status, and notices; nothing is saved", async () => {
    const { host, posts, ports, logger } = await signedIn({ submit: jest.fn(async () => { throw new FakeGitHubError("fork", 403); }) });
    await host.handle({ type: "publish.submit", project: page, draft });
    expect(ofType(posts, "publish.failed")).toEqual([{ type: "publish.failed", error: "GitHub failed at the fork step" }]);
    expect(logger.error).toHaveBeenCalledWith("writing/templates", expect.any(Error), expect.objectContaining({ step: "submit", projectId: "thesis", status: 403 }));
    expect(errorNotices(posts)).toHaveLength(1);
    expect(ports.saveToMyTemplates).not.toHaveBeenCalled();
    expect(ofType(posts, "publish.submitted")).toHaveLength(0);
  });

  it("a local save failure after the pull request still posts publish.submitted, with a logged error notice", async () => {
    const { host, posts, logger } = await signedIn({ saveToMyTemplates: jest.fn(async () => { throw new Error("disk full"); }) });
    await host.handle({ type: "publish.submit", project: page, draft });
    expect(ofType(posts, "publish.submitted")).toHaveLength(1);
    expect(ofType(posts, "publish.failed")).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith("writing/templates", expect.any(Error), expect.objectContaining({ step: "saveToMyTemplates", projectId: "thesis" }));
    expect(errorNotices(posts)).toHaveLength(1);
  });

  it("re-runs the checks when the draft changed since the last passing run", async () => {
    const { host, ports } = await signedIn();
    await host.handle({ type: "publish.check", project: page, draft });
    await host.handle({ type: "publish.submit", project: page, draft: { ...draft, description: "edited" } });
    expect(ports.check).toHaveBeenCalledTimes(2);
    expect(ports.submit).toHaveBeenCalledTimes(1);
  });

  it("re-runs the checks when the last report failed, and stops when they still fail", async () => {
    const check = jest.fn(async () => failing());
    const { host, posts, ports } = await signedIn({ check });
    await host.handle({ type: "publish.check", project: page, draft });
    await host.handle({ type: "publish.submit", project: page, draft });
    expect(check).toHaveBeenCalledTimes(2);
    expect(ports.submit).not.toHaveBeenCalled();
    expect(ofType(posts, "publish.failed")).toHaveLength(1);
  });

  it("without a sign-in posts publish.failed and opens no pull request", async () => {
    const { host, posts, ports } = setup();
    await host.handle({ type: "publish.submit", project: page, draft });
    expect(ports.submit).not.toHaveBeenCalled();
    expect(ofType(posts, "publish.failed")).toHaveLength(1);
  });
});
