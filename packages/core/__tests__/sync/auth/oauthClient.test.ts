import { resolveOAuthClient } from "../../../src/index";

const BUILT_IN = { clientId: "built-in-id", clientSecret: "built-in-secret" };

describe("resolveOAuthClient", () => {
  it("uses LABSHELF_GOOGLE_CLIENT_ID / _SECRET from the environment", () => {
    expect(resolveOAuthClient({ LABSHELF_GOOGLE_CLIENT_ID: "env-id", LABSHELF_GOOGLE_CLIENT_SECRET: "env-secret" }, BUILT_IN))
      .toEqual({ clientId: "env-id", clientSecret: "env-secret" });
  });

  it("falls back to the built-in client when the environment sets nothing", () => {
    expect(resolveOAuthClient({}, BUILT_IN)).toEqual(BUILT_IN);
  });

  it("takes the id and the secret from the environment independently", () => {
    expect(resolveOAuthClient({ LABSHELF_GOOGLE_CLIENT_ID: "env-id" }, BUILT_IN))
      .toEqual({ clientId: "env-id", clientSecret: "built-in-secret" });
  });

  it("reads a placeholder secret as no secret (a client may be public)", () => {
    expect(resolveOAuthClient({ LABSHELF_GOOGLE_CLIENT_ID: "env-id", LABSHELF_GOOGLE_CLIENT_SECRET: "YOUR_SECRET_HERE" }, BUILT_IN))
      .toEqual({ clientId: "env-id", clientSecret: "" });
  });

  it("treats a YOUR_ placeholder id as not configured, whatever the secret", () => {
    const placeholder = { clientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID", clientSecret: "YOUR_GOOGLE_OAUTH_CLIENT_SECRET" };
    expect(resolveOAuthClient({}, placeholder)).toBeUndefined();
    expect(resolveOAuthClient({ LABSHELF_GOOGLE_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID", LABSHELF_GOOGLE_CLIENT_SECRET: "s" }, BUILT_IN)).toBeUndefined();
  });

  it("lets a real environment client replace a placeholder built-in one", () => {
    const placeholder = { clientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID", clientSecret: "YOUR_GOOGLE_OAUTH_CLIENT_SECRET" };
    expect(resolveOAuthClient({ LABSHELF_GOOGLE_CLIENT_ID: "mine" }, placeholder)).toEqual({ clientId: "mine", clientSecret: "" });
  });

  it("is not configured when there is no id anywhere", () => {
    expect(resolveOAuthClient({}, { clientId: "", clientSecret: "" })).toBeUndefined();
  });
});
