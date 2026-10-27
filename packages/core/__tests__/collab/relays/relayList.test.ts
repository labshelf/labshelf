/** Pins the relay list of the index doc: list order, one entry per URL, untrusted entries skipped, removal of one's own only. */
import * as Y from "yjs";
import { addRelay, readShareIndexDocRelays, readRelayList, removeOwnRelay } from "../../../src/collab/relays/index";

const ONE = "https://one.example.workers.dev";
const TWO = "https://two.example.workers.dev";

describe("relay list", () => {
  it("keeps the order relays were offered in and each URL once", () => {
    const index = new Y.Doc();
    expect(addRelay(index, { url: ONE, addedBy: "Ada" })).toBe(true);
    expect(addRelay(index, { url: TWO, addedBy: "Grace" })).toBe(true);
    expect(addRelay(index, { url: ONE, addedBy: "Grace" })).toBe(false);
    expect(addRelay(index, { url: "http://plain.example", addedBy: "Grace" })).toBe(false);
    expect(readRelayList(index)).toEqual([{ url: ONE, addedBy: "Ada" }, { url: TWO, addedBy: "Grace" }]);
  });

  it("skips entries a peer wrote in another shape", () => {
    const index = new Y.Doc();
    readShareIndexDocRelays(index).push([{ url: "ftp://x", addedBy: "Ada" } as never, { url: TWO } as never, { url: ONE, addedBy: "Ada" }, { url: ONE, addedBy: "Eve" }]);
    expect(readRelayList(index)).toEqual([{ url: ONE, addedBy: "Ada" }]);
  });

  it("lets a member remove only a relay they offered", () => {
    const index = new Y.Doc();
    addRelay(index, { url: ONE, addedBy: "Ada" });
    addRelay(index, { url: TWO, addedBy: "Grace" });
    expect(removeOwnRelay(index, ONE, "Grace")).toBe(false);
    expect(removeOwnRelay(index, TWO, "Grace")).toBe(true);
    expect(readRelayList(index)).toEqual([{ url: ONE, addedBy: "Ada" }]);
  });
});
