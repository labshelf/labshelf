// Verifies that binary thumbnail replies can unblock a publication waiting in the ordered socket queue.
import { createDispatcher } from "../../../../../src/writing/helper/node/dispatch/index";
import { PROTOCOL_VERSION } from "../../../../../src/writing/helper/index";

it("delivers thumbnail payloads before the waiting publication finishes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let received: Uint8Array | undefined;
  const logger = { log: async () => {}, error: async () => {} };
  const dispatcher = createDispatcher({
    publishTemplate: async () => { await gate; },
    templateThumbnail: async (_message, _send, payload) => { received = payload; release(); },
  }, logger);
  const png = new Uint8Array([137, 80, 78, 71]);
  dispatcher.handle({ v: PROTOCOL_VERSION, id: "publication", type: "publishTemplate", projectId: "paper", action: "open" }, new Uint8Array(), () => {});
  dispatcher.handle({ v: PROTOCOL_VERSION, id: "thumbnail", type: "templateThumbnail", requestId: "publication" }, png, () => {});
  try { expect(received).toEqual(png); }
  finally { release(); await dispatcher.drain(); }
});
