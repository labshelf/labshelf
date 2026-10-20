/** Pins that the mirror writes comments.json from the comments map, keeps an invalid file, and writes nothing for an empty map. */
import { addLiveThread, replyToLiveThread } from "../../../src/collab/comments/index";
import { memoryFiles, nodeFiles } from "./mirrorFiles";
import { openMirror, readFile, writeFile, type MirrorFixture } from "./mirrorFixture";

const COMMENTS = ".labshelf/comments.json";
const thread = {
  id: "t1", file: "main.typ", anchor: { quote: "hello", prefix: "", suffix: "" }, resolved: false,
  comments: [{ id: "c1", author: "Ada", body: "Why?", createdAt: "2026-10-20T10:00:00.000Z" }],
};

describe.each([nodeFiles, memoryFiles()])("comments.json in a mirror over a $name", (files) => {
  let fixture: MirrorFixture;
  afterEach(async () => { await fixture.close(); });

  it("follows the comments map, a reply included", async () => {
    fixture = await openMirror({ files });
    await fixture.mirror.idle();
    expect(fixture.diskChanges).not.toContain(COMMENTS);

    addLiveThread(fixture.session.index, thread);
    await fixture.mirror.idle();
    expect(JSON.parse(await readFile(fixture, COMMENTS)).threads.map((each: { id: string }) => each.id)).toEqual(["t1"]);

    replyToLiveThread(fixture.session.index, "t1", { id: "c2", author: "Grace", body: "Because.", createdAt: "2026-10-20T10:01:00.000Z" });
    await fixture.mirror.idle();
    expect(JSON.parse(await readFile(fixture, COMMENTS)).threads[0].comments).toHaveLength(2);
  });

  it("keeps a comments.json that is not valid and warns", async () => {
    fixture = await openMirror({ files });
    await writeFile(fixture, COMMENTS, "{ not json");
    addLiveThread(fixture.session.index, thread);
    await fixture.mirror.idle();
    expect(await readFile(fixture, COMMENTS)).toBe("{ not json");
    expect(fixture.logger.log.mock.calls.some(([level, , message]) => level === "WARN" && /comments\.json/.test(message))).toBe(true);
  });
});
