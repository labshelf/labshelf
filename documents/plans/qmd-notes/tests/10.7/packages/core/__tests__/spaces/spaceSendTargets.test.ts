// Tests that the Space Send to writers append quotes to Space notes and threads, writing figure blobs through the asset writer first.
import { createSpaceSendWriters } from "../../src/spaces/index";
import type { SpaceAssetWriter } from "../../src/spaces/spaceSendTargets";
import type { SpaceNotesStore } from "../../src/spaces/spaceNotesStore";
import type { SpaceDiscussionsStore } from "../../src/spaces/spaceDiscussionsStore";

const QUOTE_BODY = "> Attention is all you need.\n\n[vaswani2017, p. 3](labshelf:vaswani2017#p3)";

function fakeStores() {
  const noteAdds: Array<{ spaceId: string; path: string; body: string; author?: string | undefined; id?: string | undefined }> = [];
  const messageAdds: Array<{ spaceId: string; path: string; body: string; author?: string | undefined; id?: string | undefined }> = [];
  const assetWrites: Array<{ spaceId: string; path: string; bytes: Uint8Array }> = [];
  const order: string[] = [];
  const state = { failAsset: false };
  const notes = {
    addItem: async (spaceId: string, path: string, body: string, author?: string, id?: string) => {
      noteAdds.push({ spaceId, path, body, author, id });
      return id ?? "item1";
    },
  } as unknown as SpaceNotesStore;
  const discussions = {
    addMessage: async (spaceId: string, path: string, body: string, author?: string, id?: string) => {
      order.push("addMessage");
      messageAdds.push({ spaceId, path, body, author, id });
      return id ?? "msg1";
    },
  } as unknown as SpaceDiscussionsStore;
  const assets: SpaceAssetWriter = {
    write: async (spaceId, path, bytes) => {
      order.push("asset");
      if (state.failAsset) throw new Error("disk full");
      assetWrites.push({ spaceId, path, bytes });
    },
  };
  return { noteAdds, messageAdds, assetWrites, order, state, notes, discussions, assets };
}

describe("createSpaceSendWriters spaceNote", () => {
  it("10.7a sending a quote to a Space note appends one item with the labshelf: back-link", async () => {
    const s = fakeStores();
    const writers = createSpaceSendWriters(s.notes, s.discussions, s.assets);
    await writers.spaceNote.append({ kind: "spaceNote", spaceId: "sp1", path: "notes/ideas.qmd" }, QUOTE_BODY);
    expect(s.noteAdds).toHaveLength(1);
    expect(s.noteAdds[0]?.spaceId).toBe("sp1");
    expect(s.noteAdds[0]?.path).toBe("notes/ideas.qmd");
    expect(s.noteAdds[0]?.body).toContain("labshelf:vaswani2017#p3");
    expect(s.noteAdds[0]?.body).toContain("> Attention is all you need.");
  });

  it("10.7a a send to a Space note does not touch the discussions store", async () => {
    const s = fakeStores();
    const writers = createSpaceSendWriters(s.notes, s.discussions, s.assets);
    await writers.spaceNote.append({ kind: "spaceNote", spaceId: "sp1", path: "notes/ideas.qmd" }, QUOTE_BODY);
    expect(s.messageAdds).toHaveLength(0);
  });
});

describe("createSpaceSendWriters spaceNote extra", () => {
  it("10.7a a send to a Space note passes the author and item id from extra to addItem", async () => {
    const s = fakeStores();
    const writers = createSpaceSendWriters(s.notes, s.discussions, s.assets);
    await writers.spaceNote.append(
      { kind: "spaceNote", spaceId: "sp1", path: "notes/ideas.qmd" },
      QUOTE_BODY,
      { itemId: "n-2", author: "Ana" },
    );
    expect(s.noteAdds).toHaveLength(1);
    expect(s.noteAdds[0]?.author).toBe("Ana");
    expect(s.noteAdds[0]?.id).toBe("n-2");
  });
});

describe("createSpaceSendWriters discussion", () => {
  const THREAD = { kind: "discussion", spaceId: "sp1", path: "discussions/thread1.qmd" } as const;

  it("10.7b appending a quote to a thread calls addMessage with the author and the item id", async () => {
    const s = fakeStores();
    const writers = createSpaceSendWriters(s.notes, s.discussions, s.assets);
    await writers.discussion.append(THREAD, QUOTE_BODY, { itemId: "n-1", author: "Ana" });
    expect(s.messageAdds).toHaveLength(1);
    expect(s.messageAdds[0]?.spaceId).toBe("sp1");
    expect(s.messageAdds[0]?.path).toBe("discussions/thread1.qmd");
    expect(s.messageAdds[0]?.body).toContain("labshelf:vaswani2017#p3");
    expect(s.messageAdds[0]?.author).toBe("Ana");
    expect(s.messageAdds[0]?.id).toBe("n-1");
  });

  it("10.7b a quote sent to a thread does not touch the notes store or the asset writer", async () => {
    const s = fakeStores();
    const writers = createSpaceSendWriters(s.notes, s.discussions, s.assets);
    await writers.discussion.append(THREAD, QUOTE_BODY, { itemId: "n-1", author: "Ana" });
    expect(s.noteAdds).toHaveLength(0);
    expect(s.assetWrites).toHaveLength(0);
  });

  it("10.7b a figure writes discussions/assets/n-1.png through the asset writer", async () => {
    const s = fakeStores();
    const writers = createSpaceSendWriters(s.notes, s.discussions, s.assets);
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await writers.discussion.append(THREAD, "![fig](assets/n-1.png)", {
      itemId: "n-1",
      author: "Ana",
      blob: { path: "assets/n-1.png", bytes },
    });
    expect(s.assetWrites).toHaveLength(1);
    expect(s.assetWrites[0]?.spaceId).toBe("sp1");
    expect(s.assetWrites[0]?.path).toBe("discussions/assets/n-1.png");
    expect(Array.from(s.assetWrites[0]?.bytes ?? [])).toEqual([137, 80, 78, 71]);
    expect(s.messageAdds).toHaveLength(1);
    expect(s.messageAdds[0]?.id).toBe("n-1");
  });

  it("10.7b a figure is written before addMessage is called", async () => {
    const s = fakeStores();
    const writers = createSpaceSendWriters(s.notes, s.discussions, s.assets);
    await writers.discussion.append(THREAD, "![fig](assets/n-1.png)", {
      itemId: "n-1",
      author: "Ana",
      blob: { path: "assets/n-1.png", bytes: new Uint8Array([1]) },
    });
    expect(s.order).toEqual(["asset", "addMessage"]);
  });

  it("10.7b a rejected asset write rejects append and calls no addMessage", async () => {
    const s = fakeStores();
    s.state.failAsset = true;
    const writers = createSpaceSendWriters(s.notes, s.discussions, s.assets);
    await expect(
      writers.discussion.append(THREAD, "![fig](assets/n-1.png)", {
        itemId: "n-1",
        author: "Ana",
        blob: { path: "assets/n-1.png", bytes: new Uint8Array([1]) },
      }),
    ).rejects.toThrow("disk full");
    expect(s.messageAdds).toHaveLength(0);
  });
});
