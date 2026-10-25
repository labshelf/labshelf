/** A profile from before custom resolvers keeps its mirror as one enabled entry, and loses the old keys. */
import { migrateMirrorSettings } from "../../src/platform/mirrorToCustomResolver";

describe("migrateMirrorSettings", () => {
  it("turns an enabled mirror into one enabled entry and removes the old keys", () => {
    expect(migrateMirrorSettings({ enableSciHub: true, sciHubMirror: "https://mirror.example//", contactEmail: "me@uni.edu" })).toEqual({
      contactEmail: "me@uni.edu",
      customResolvers: [{ name: "Custom resolver", template: "https://mirror.example/{doi}", enabled: true }],
    });
  });

  it("adds no entry when the toggle was off or missing, but still removes the old keys", () => {
    expect(migrateMirrorSettings({ enableSciHub: false, sciHubMirror: "https://mirror.example" })).toEqual({});
    expect(migrateMirrorSettings({ sciHubMirror: "https://mirror.example", proxies: [] })).toEqual({ proxies: [] });
  });

  it("appends after existing entries and skips an identical template", () => {
    const mine = { name: "Mine", template: "https://other.example/{doi}", enabled: true };
    const old = { enableSciHub: true, sciHubMirror: "https://mirror.example" };
    const migrated = migrateMirrorSettings({ ...old, customResolvers: [mine] });
    expect(migrated?.["customResolvers"]).toEqual([mine, { name: "Custom resolver", template: "https://mirror.example/{doi}", enabled: true }]);
    const twin = { name: "Twin", template: "https://mirror.example/{doi}", enabled: false };
    expect(migrateMirrorSettings({ ...old, customResolvers: [twin] })?.["customResolvers"]).toEqual([twin]);
  });

  it("leaves current settings alone", () => {
    expect(migrateMirrorSettings({ contactEmail: "me@uni.edu", customResolvers: [] })).toBeUndefined();
  });
});
