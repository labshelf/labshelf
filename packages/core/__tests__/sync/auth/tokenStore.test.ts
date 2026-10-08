import { parseTokens, type TokenData } from "../../../src/index";

const TOKENS: TokenData = { access_token: "access-1", refresh_token: "refresh-1", expiry_ms: 1_800_000_000_000 };

describe("parseTokens", () => {
  it("accepts a complete token record", () => {
    expect(parseTokens(JSON.stringify(TOKENS))).toEqual(TOKENS);
  });

  it.each([[null], [undefined], [""]])("returns null for %p", (input) => {
    expect(parseTokens(input as string | null | undefined)).toBeNull();
  });

  it.each([["{ not json"], ["null"], ["42"], ["[]"], ['"text"']])("returns null for non-record JSON %j", (input) => {
    expect(parseTokens(input)).toBeNull();
  });

  it.each([
    [{ access_token: "a", expiry_ms: 1 }],
    [{ access_token: "a", refresh_token: "", expiry_ms: 1 }],
    [{ access_token: "a", refresh_token: 42, expiry_ms: 1 }],
    [{ access_token: "a", refresh_token: null, expiry_ms: 1 }],
  ])("requires a non-empty string refresh token (%j)", (raw) => {
    expect(parseTokens(JSON.stringify(raw))).toBeNull();
  });

  it("defaults a missing or mistyped access token to '' and expiry to 0 (it is refreshed on first use)", () => {
    expect(parseTokens(JSON.stringify({ refresh_token: "r" }))).toEqual({ access_token: "", refresh_token: "r", expiry_ms: 0 });
    expect(parseTokens(JSON.stringify({ refresh_token: "r", access_token: 5, expiry_ms: "123" })))
      .toEqual({ access_token: "", refresh_token: "r", expiry_ms: 0 });
  });

  it("drops unknown keys", () => {
    expect(parseTokens(JSON.stringify({ ...TOKENS, scope: "drive", id_token: "x" }))).toEqual(TOKENS);
  });
});
