// Pins how the gallery host answers a malformed publish.* message: the page is told, and the failure is logged.
import type { HostToGallery } from "@labshelf/core";
import { createGalleryHost } from "../../../src/writing/templates/galleryHost.js";
import { fakeLogger } from "../../support/writingFixtures.js";

function setup() {
  const posts: HostToGallery[] = [];
  const logger = fakeLogger();
  const publish = { open: jest.fn(async () => {}), handle: jest.fn(async () => {}) };
  const host = createGalleryHost({
    sources: [], engines: jest.fn(), askTitle: jest.fn(), createProject: jest.fn(), logger, publish, post: (m: HostToGallery) => { posts.push(m); },
  } as never);
  return { host, posts, logger, publish };
}

describe("GalleryHost: malformed publish messages", () => {
  it.each(["publish.check", "publish.submit"])("answers a malformed %s with publish.failed and logs it", async (type) => {
    const { host, posts, logger, publish } = setup();
    await host.handle({ type, project: "nope" });
    expect(publish.handle).not.toHaveBeenCalled();
    expect(posts).toEqual([{ type: "publish.failed", error: expect.any(String) }]);
    expect((posts[0] as { error: string }).error).not.toBe("");
    const logged = logger.error.mock.calls.length + logger.log.mock.calls.length;
    expect(logged).toBeGreaterThan(0);
  });

  it("does not post publish.failed for a malformed non-publish message", async () => {
    const { host, posts } = setup();
    await host.handle({ type: "detail" });
    expect(posts).toEqual([]);
  });
});
