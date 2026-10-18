/** Pins how TURN credentials reach node-datachannel, which takes them only inside the URL. */
import { toNativeIceServers } from "../../../../src/collab/node/rtc/index";

describe("toNativeIceServers", () => {
  it("puts a TURN server's credentials into each of its URLs", () => {
    expect(toNativeIceServers([{ urls: ["turn:turn.example.org:3478", "turns:turn.example.org:5349?transport=tcp"], username: "ann", credential: "p@ss:w" }]))
      .toEqual(["turn:ann:p%40ss%3Aw@turn.example.org:3478", "turns:ann:p%40ss%3Aw@turn.example.org:5349?transport=tcp"]);
  });

  it("keeps STUN URLs and servers without credentials as they are", () => {
    expect(toNativeIceServers([{ urls: "stun:stun.example.org:3478", username: "ann", credential: "x" }, { urls: "turn:t.example.org" }]))
      .toEqual(["stun:stun.example.org:3478", "turn:t.example.org"]);
  });
});
