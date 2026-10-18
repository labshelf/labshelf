import { buildHostManifest, HELPER_ALLOWED_ORIGINS } from "../../../src/helper/register/index.js";

describe("buildHostManifest", () => {
  it("lists the extension origins for Chromium browsers", () => {
    expect(buildHostManifest("chromium", "/opt/h")).toEqual({
      name: "dev.labshelf.helper",
      description: "LabShelf Helper",
      path: "/opt/h",
      type: "stdio",
      allowed_origins: HELPER_ALLOWED_ORIGINS,
    });
    expect(HELPER_ALLOWED_ORIGINS).toContain("chrome-extension://ghcjlkjggiffdekaneoaoklhedjeeklh/");
  });

  it("lists the gecko id for Firefox", () => {
    expect(buildHostManifest("firefox", "/opt/h")).toEqual({
      name: "dev.labshelf.helper",
      description: "LabShelf Helper",
      path: "/opt/h",
      type: "stdio",
      allowed_extensions: ["labshelf@lucanaasser.dev"],
    });
  });
});
