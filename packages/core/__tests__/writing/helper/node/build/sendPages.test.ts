/** Verifies that sendPages records the sent page hashes only after both replies went out, and refuses pages that exceed the socket message limit with a limit error. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";
import { cleanupTempDirs, makeTempDir } from "../../../../support/tempDirs";
import { MAX_SOCKET_MESSAGE_BYTES } from "../../../../../src/writing/helper/index";
import { sendPages } from "../../../../../src/writing/helper/node/build/sendPages";
import * as pages from "../../../../../src/writing/helper/node/pages/index";

afterEach(async () => { jest.restoreAllMocks(); await cleanupTempDirs(); });

async function pdfFile(): Promise<string> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  const file = path.join(await makeTempDir(), "main.pdf");
  await fs.writeFile(file, await doc.save());
  return file;
}

it("keeps the previous hashes when a reply cannot be sent", async () => {
  const sent = { hashes: [] as string[] };
  const send = jest.fn(() => { throw new Error("socket closed"); });
  await expect(sendPages("1", await pdfFile(), [], sent, send)).rejects.toThrow("socket closed");
  expect(sent.hashes).toEqual([]);
});

it("records the hashes after both replies are sent", async () => {
  const sent = { hashes: [] as string[] };
  const send = jest.fn();
  await sendPages("1", await pdfFile(), [], sent, send);
  expect(send.mock.calls.map(([message]) => (message as { type: string }).type)).toEqual(["built", "pages"]);
  expect(sent.hashes).toHaveLength(1);
});

it("refuses changed pages over the socket message limit with a limit error and sends nothing", async () => {
  jest.spyOn(pages, "diffPages").mockResolvedValue({ pageCount: 1, hashes: ["h"], changed: [{ index: 0, bytes: new Uint8Array(MAX_SOCKET_MESSAGE_BYTES) }] });
  const sent = { hashes: [] as string[] };
  const send = jest.fn();
  await expect(sendPages("1", await pdfFile(), [], sent, send)).rejects.toMatchObject({ code: "limit" });
  expect(send).not.toHaveBeenCalled();
  expect(sent.hashes).toEqual([]);
});
