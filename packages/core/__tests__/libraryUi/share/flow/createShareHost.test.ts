/** Pins what the assembled sharing host offers, how it refuses a half the app does not run, and its clipboard and link checks. */
import type { ILogger } from "../../../../src/ports/index";
import { createShareHost } from "../../../../src/libraryUi/share/flow/index";

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;

function host(write: (text: string) => Promise<void> = async () => undefined) {
  const openLink = jest.fn(async () => undefined);
  return { openLink, sharing: createShareHost({ place: "this device", logger, clipboard: { write }, openLink }) };
}

describe("createSharingHost", () => {
  it("offers neither half and refuses their operations when the app runs none", async () => {
    const { sharing } = host();
    expect(sharing.offers()).toEqual({ projects: false, links: false });
    await expect(sharing.shareProject("p", new AbortController().signal)).rejects.toThrow("does not share projects");
    await expect(sharing.sharedLinks()).rejects.toThrow("does not share folders");
  });

  it("answers false when the clipboard refuses the copy", async () => {
    const { sharing } = host(async () => { throw new Error("denied"); });
    await expect(sharing.copyText("x")).resolves.toBe(false);
    await expect(host().sharing.copyText("x")).resolves.toBe(true);
  });

  it("opens only web links", async () => {
    const { sharing, openLink } = host();
    await expect(sharing.openLink("javascript:alert(1)")).rejects.toThrow("only web links");
    await sharing.openLink("https://share.example/share/#k");
    expect(openLink).toHaveBeenCalledTimes(1);
  });
});
