/** Pins the relay host codec: the short Worker form, whole-host round trips, and what each direction refuses. */
import { formatRelayHost, parseRelayHost } from "../../src/relay/relayHost";

const workerUrl = "https://ls-abcdefghijkl.someone.workers.dev";

describe("relay host codec", () => {
  it("1.1a writes an ls- Worker URL as <name>.<subdomain> and reads it back to the URL", () => {
    expect(formatRelayHost(workerUrl)).toBe("abcdefghijkl.someone");
    expect(parseRelayHost("abcdefghijkl.someone")).toBe(workerUrl);
  });

  it.each([
    "https://relay.example",
    "https://relay.someone.workers.dev",
    "https://labshelf-relay.owner.workers.dev",
    "https://host.example:8443",
  ])("1.1b round trips the whole host of %s", (url) => {
    const text = formatRelayHost(url);
    expect(text).toBe(new URL(url).host);
    expect(parseRelayHost(text)).toBe(url);
  });

  it("1.1b keeps the read URL free of a trailing slash", () => {
    expect(parseRelayHost("relay.example")?.endsWith("/")).toBe(false);
  });

  it("1.1c refuses to write an http relay and to read a path", () => {
    expect(() => formatRelayHost("http://relay.example")).toThrow(TypeError);
    expect(parseRelayHost("a/b")).toBeUndefined();
  });

  it.each([
    ["http scheme", "http://relay.example"],
    ["a path", "https://relay.example/relay"],
    ["a query", "https://relay.example/?a=1"],
    ["a hash", "https://relay.example/#x"],
    ["userinfo", "https://user:pass@relay.example"],
    ["an ambiguous whole host", "https://abcdefghijkl.com"],
    ["not a URL", "not a url"],
  ])("1.1c refuses to write %s", (_label, url) => {
    expect(() => formatRelayHost(url)).toThrow(TypeError);
  });

  it.each([["empty text", ""], ["a path", "a/b"], ["upper case", "Upper.Case"], ["a tilde", "x~y"]])(
    "1.1c refuses to read %s",
    (_label, text) => {
      expect(parseRelayHost(text)).toBeUndefined();
    },
  );
});
