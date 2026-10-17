// The one runtime request helper returns the reply's data and throws the background's error text.
const sendMessage = jest.fn();
jest.mock("webextension-polyfill", () => ({ runtime: { sendMessage: (m: unknown) => sendMessage(m) } }));

import { sendRuntime } from "../../src/platform/sendRuntime";

describe("sendRuntime", () => {
  beforeEach(() => sendMessage.mockReset());

  it("sends the message and returns the data of an ok reply", async () => {
    sendMessage.mockResolvedValue({ ok: true, data: { folders: [] } });
    expect(await sendRuntime({ type: "library.folders" })).toEqual({ folders: [] });
    expect(sendMessage).toHaveBeenCalledWith({ type: "library.folders" });
  });

  it("throws the error text of a refused reply", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "Not allowed from this page" });
    await expect(sendRuntime({ type: "library.folders" })).rejects.toThrow("Not allowed from this page");
  });
});
