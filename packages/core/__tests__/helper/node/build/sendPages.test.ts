/** Verifies that sendPages records the sent page hashes only after both replies went out, and refuses pages that exceed the socket message limit with a limit error. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";
import { MAX_SOCKET_MESSAGE_BYTES } from "../../../../src/helper/index";
import { sendPages, type SentPages } from "../../../../src/helper/node/build/index";
import * as pages from "../../../../src/helper/node/comparePages";

afterEach(async () => { jest.restoreAllMocks(); await cleanupTempDirs(); });

async function pdfFile(): Promise<string> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  const file = path.join(await makeTempDir(), "main.pdf");
  await fs.writeFile(file, await doc.save());
  return file;
}

it("keeps the previous hashes when a reply cannot be sent", async () => {
  const sent: SentPages = { hashes: [] };
  const send = jest.fn(() => { throw new Error("socket closed"); });
  await expect(sendPages("1", await pdfFile(), [], sent, send)).rejects.toThrow("socket closed");
  expect(sent.hashes).toEqual([]);
  expect(sent.pdfSha256).toBeUndefined();
});

it("records the hashes after both replies are sent", async () => {
  const sent: SentPages = { hashes: [] };
  const send = jest.fn();
  await sendPages("1", await pdfFile(), [], sent, send);
  expect(send.mock.calls.map(([message]) => (message as { type: string }).type)).toEqual(["built", "pages"]);
  expect(sent.hashes).toHaveLength(1);
});

it("refuses changed pages over the socket message limit with a limit error and sends nothing", async () => {
  jest.spyOn(pages, "comparePages").mockResolvedValue({ pageCount: 1, hashes: ["h"], changed: [{ index: 0, bytes: new Uint8Array(MAX_SOCKET_MESSAGE_BYTES) }] });
  const sent: SentPages = { hashes: [] };
  const send = jest.fn();
  await expect(sendPages("1", await pdfFile(), [], sent, send)).rejects.toMatchObject({ code: "limit" });
  expect(send).not.toHaveBeenCalled();
  expect(sent.hashes).toEqual([]);
  expect(sent.pdfSha256).toBeUndefined();
});

it("reuses page hashes for identical PDF bytes without splitting the PDF again", async () => {
  const diff = jest.spyOn(pages, "comparePages");
  const sent: SentPages = { hashes: [] };
  const send = jest.fn();
  const file = await pdfFile();
  await sendPages("1", file, [], sent, send);
  await sendPages("2", file, [], sent, send);
  expect(diff).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[3]?.[0]).toMatchObject({ type: "pages", pageCount: 1, changed: [] });
});

it("retries page delivery after the pages reply fails", async () => {
  const diff = jest.spyOn(pages, "comparePages");
  const sent: SentPages = { hashes: [] };
  const file = await pdfFile();
  const send = jest.fn().mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error("socket closed"); });
  await expect(sendPages("1", file, [], sent, send)).rejects.toThrow("socket closed");
  expect(sent.pdfSha256).toBeUndefined();
  await sendPages("2", file, [], sent, send);
  expect(diff).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[3]?.[0].changed).toHaveLength(1);
});
