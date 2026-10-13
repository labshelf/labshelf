import { createNonce } from "../../src/ui/createNonce";

describe("createNonce", () => {
  it("returns 32 lowercase hex characters", () => {
    expect(createNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns a different value on every call", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});
