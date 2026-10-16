import type { ILogger, PaperRecord } from "@labshelf/core";
import { openLinkParam, type OpenLinkDeps } from "../../../src/library-page/openLink/openLinkParam";

const library = [{ id: "p1", citeKey: "vaswani2017" } as PaperRecord];

function setup(listRecords: OpenLinkDeps["listRecords"] = async () => library) {
  const log = { log: jest.fn(), error: jest.fn() } as unknown as ILogger;
  const deps = { listRecords, goToReader: jest.fn(), notifyError: jest.fn(), log };
  return { deps, log };
}

describe("openLinkParam", () => {
  it("opens the reader at the page", async () => {
    const { deps } = setup();
    await openLinkParam("?link=web%2Blabshelf%3Avaswani2017%23p5", deps);
    expect(deps.goToReader).toHaveBeenCalledWith("p1", 5);
    expect(deps.notifyError).not.toHaveBeenCalled();
  });
  it("opens the reader without a page", async () => {
    const { deps } = setup();
    await openLinkParam("?link=web%2Blabshelf%3Avaswani2017", deps);
    expect(deps.goToReader).toHaveBeenCalledWith("p1", undefined);
  });
  it("shows the missing key and logs it", async () => {
    const { deps, log } = setup();
    await openLinkParam("?link=web%2Blabshelf%3Anobody1999", deps);
    expect(deps.goToReader).not.toHaveBeenCalled();
    expect(deps.notifyError).toHaveBeenCalledWith(expect.stringContaining("nobody1999"));
    expect(log.log).toHaveBeenCalledWith("WARN", "library-link", "Link not opened", expect.objectContaining({ link: "web+labshelf:nobody1999" }));
  });
  it("shows an error for a malformed link", async () => {
    const { deps } = setup();
    await openLinkParam("?link=hello", deps);
    expect(deps.goToReader).not.toHaveBeenCalled();
    expect(deps.notifyError).toHaveBeenCalledTimes(1);
  });
  it("shows and logs a library read failure", async () => {
    const { deps, log } = setup(async () => { throw new Error("db closed"); });
    await openLinkParam("?link=web%2Blabshelf%3Avaswani2017", deps);
    expect(deps.notifyError).toHaveBeenCalledWith(expect.stringContaining("db closed"));
    expect(log.error).toHaveBeenCalled();
  });
  it("does nothing without a link parameter", async () => {
    const { deps } = setup();
    await openLinkParam("?paper=p1", deps);
    expect(deps.goToReader).not.toHaveBeenCalled();
    expect(deps.notifyError).not.toHaveBeenCalled();
  });
});
