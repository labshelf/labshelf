// Verifies template publication events and the binary PDF-to-PNG round trip over the helper client.
import { createNativeLatexHelper } from "../../../src/helper/client";
import { decodeConnectionMessage } from "@labshelf/core/helper";
import { FakeHelper, fakeLogger } from "./fakeHelper";
const flush = () => new Promise((resolve) => setImmediate(resolve));

it("renders the helper's sample and sends PNG bytes tied to the waiting publication", async () => {
  const fake = new FakeHelper();
  const helper = createNativeLatexHelper({ logger: fakeLogger(), extensionVersion: "1", origin: "chrome-extension://abc", connectNative: () => fake, webSocket: fake.socketClass });
  await helper.connect();
  const pdf = new Uint8Array([37, 80, 68, 70]); const png = new Uint8Array([137, 80, 78, 71]);
  const events: unknown[] = []; const render = jest.fn(async () => png);
  const pending = helper.publishTemplate("paper", { action: "check", draft: { name: "Paper", category: "article", license: "MIT", description: "Starter" } }, (event) => events.push(event), render);
  await flush();
  const request = fake.receivedOfType("publishTemplate")[0]!;
  const socket = fake.sockets[0]!;
  const rawSend = socket.send.bind(socket);
  const bytesSent: Uint8Array[] = [];
  socket.send = (bytes) => { bytesSent.push(bytes); rawSend(bytes); };
  socket.deliver({ id: request.id, type: "templatePreview" }, pdf);
  await flush();
  expect(render).toHaveBeenCalledWith(pdf);
  const thumbnail = bytesSent.map(decodeConnectionMessage).find((m) => m.envelope.type === "templateThumbnail")!;
  expect(thumbnail.envelope.requestId).toBe(request.id); expect(thumbnail.payload).toEqual(png);
  socket.deliver({ id: request.id, type: "templatePublish", done: false, event: { type: "publish.checks", checks: [{ id: "thumbnail", ok: true }], running: false } });
  socket.deliver({ id: request.id, type: "templatePublish", done: true });
  await pending;
  expect(events).toEqual([{ type: "publish.checks", checks: [{ id: "thumbnail", ok: true }], running: false }]);
  helper.disconnect();
});

it("reports a render failure to the waiting helper", async () => {
  const fake = new FakeHelper(); const logger = fakeLogger();
  const helper = createNativeLatexHelper({ logger, extensionVersion: "1", origin: "chrome-extension://abc", connectNative: () => fake, webSocket: fake.socketClass });
  const pending = helper.publishTemplate("paper", { action: "open" }, () => {}, async () => { throw new Error("Invalid PDF"); });
  await flush();
  const request = fake.receivedOfType("publishTemplate")[0]!;
  fake.sockets[0]!.deliver({ id: request.id, type: "templatePreview" }, new Uint8Array([1]));
  await flush();
  expect(fake.receivedOfType("templateThumbnail")[0]).toMatchObject({ requestId: request.id, error: "Invalid PDF" });
  fake.sockets[0]!.deliver({ id: request.id, type: "templatePublish", done: true });
  await pending; helper.disconnect();
});
