/** Settings read what storage holds, and drop proxy entries that storage cannot be trusted to have shaped right. */
const store: Record<string, unknown> = {};
jest.mock("webextension-polyfill", () => ({
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => { Object.assign(store, items); },
    },
  },
}));

import { SETTINGS_STORAGE_KEY, getSettings, updateSettings } from "../../src/platform/settings";

const proxy = { name: "Uni library", template: "https://login.ezproxy.uni.edu/login?url=$@", enabled: true };

beforeEach(() => { delete store[SETTINGS_STORAGE_KEY]; });

describe("settings proxies", () => {
  it("defaults to no proxies", async () => {
    expect((await getSettings()).proxies).toEqual([]);
  });

  it("reads back the list it saved, in order, without touching other settings", async () => {
    const list = [proxy, { name: "Second", template: ".ezproxy.other.edu", enabled: false }];
    await updateSettings({ proxies: list });
    await updateSettings({ contactEmail: "me@uni.edu" });
    const settings = await getSettings();
    expect(settings.proxies).toEqual(list);
    expect(settings.contactEmail).toBe("me@uni.edu");
  });

  it("drops stored values that are not a list", async () => {
    for (const bad of ["x", 7, { name: "a" }, null]) {
      store[SETTINGS_STORAGE_KEY] = { proxies: bad };
      expect((await getSettings()).proxies).toEqual([]);
    }
  });

  it("keeps the valid entries of a list and drops the malformed ones", async () => {
    store[SETTINGS_STORAGE_KEY] = {
      proxies: [
        proxy,
        { name: "no template", enabled: true },
        { name: 3, template: ".a.edu", enabled: true },
        { name: "string flag", template: ".a.edu", enabled: "yes" },
        null,
        "text",
      ],
    };
    expect((await getSettings()).proxies).toEqual([proxy]);
  });
});
