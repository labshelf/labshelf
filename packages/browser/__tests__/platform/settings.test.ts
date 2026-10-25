/** Settings read what storage holds, drop proxy and custom resolver entries that storage cannot be trusted to have shaped right, and migrate old mirror keys. */
const store: Record<string, unknown> = {};
jest.mock("webextension-polyfill", () => ({
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => { Object.assign(store, items); },
    },
  },
}));

import { SETTINGS_STORAGE_KEY, readSettings, updateSettings } from "../../src/platform/settings";

const proxy = { name: "Uni library", template: "https://login.ezproxy.uni.edu/login?url=$@", enabled: true };

beforeEach(() => { delete store[SETTINGS_STORAGE_KEY]; });

describe("settings proxies", () => {
  it("defaults to no proxies", async () => {
    expect((await readSettings()).proxies).toEqual([]);
  });

  it("reads back the list it saved, in order, without touching other settings", async () => {
    const list = [proxy, { name: "Second", template: ".ezproxy.other.edu", enabled: false }];
    await updateSettings({ proxies: list });
    await updateSettings({ contactEmail: "me@uni.edu" });
    const settings = await readSettings();
    expect(settings.proxies).toEqual(list);
    expect(settings.contactEmail).toBe("me@uni.edu");
  });

  it("drops stored values that are not a list", async () => {
    for (const bad of ["x", 7, { name: "a" }, null]) {
      store[SETTINGS_STORAGE_KEY] = { proxies: bad };
      expect((await readSettings()).proxies).toEqual([]);
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
    expect((await readSettings()).proxies).toEqual([proxy]);
  });
});

const resolver = { name: "Mirror", template: "https://host.example/find/{doi}", enabled: true };

describe("settings custom resolvers", () => {
  it("defaults to none and reads back the list it saved, in order", async () => {
    expect((await readSettings()).customResolvers).toEqual([]);
    const list = [resolver, { name: "Second", template: "http://other.example/?q={doi}", enabled: false }];
    await updateSettings({ customResolvers: list });
    expect((await readSettings()).customResolvers).toEqual(list);
  });

  it("keeps the usable entries of a stored list and drops the rest", async () => {
    store[SETTINGS_STORAGE_KEY] = {
      customResolvers: [
        resolver,
        { name: "no placeholder", template: "https://host.example/find", enabled: true },
        { name: "not http", template: "ftp://host.example/{doi}", enabled: true },
        { name: "flag", template: "https://host.example/{doi}", enabled: "yes" },
        null,
      ],
    };
    expect((await readSettings()).customResolvers).toEqual([resolver]);
  });

  it("drops a stored value that is not a list", async () => {
    store[SETTINGS_STORAGE_KEY] = { customResolvers: "x" };
    expect((await readSettings()).customResolvers).toEqual([]);
  });

  it("migrates the old mirror keys once and writes the result back", async () => {
    store[SETTINGS_STORAGE_KEY] = { enableSciHub: true, sciHubMirror: "https://mirror.example/", contactEmail: "me@uni.edu" };
    const settings = await readSettings();
    expect(settings.customResolvers).toEqual([{ name: "Custom resolver", template: "https://mirror.example/{doi}", enabled: true }]);
    expect(store[SETTINGS_STORAGE_KEY]).not.toHaveProperty("enableSciHub");
    expect(store[SETTINGS_STORAGE_KEY]).not.toHaveProperty("sciHubMirror");
    expect((await readSettings()).customResolvers).toEqual(settings.customResolvers);
  });
});

describe("settings for asking authors", () => {
  const languageOf = (tag: string | undefined): Promise<string> => {
    Object.defineProperty(globalThis, "navigator", { value: { language: tag }, configurable: true });
    return readSettings().then((s) => s.requestLanguage);
  };

  it("defaults to an empty signature and the browser's language", async () => {
    const settings = await readSettings();
    expect(settings.requesterName).toBe("");
    expect(settings.requesterAffiliation).toBe("");
    expect(await languageOf("pt-BR")).toBe("pt");
    expect(await languageOf("es-AR")).toBe("es");
  });

  it("falls back to English for an unsupported or missing browser language", async () => {
    expect(await languageOf("de-DE")).toBe("en");
    expect(await languageOf(undefined)).toBe("en");
  });

  it("reads back what was saved, and the saved language wins over the browser's", async () => {
    await updateSettings({ requesterName: "Ada Lovelace", requesterAffiliation: "Analytical Engine Lab", requestLanguage: "es" });
    const settings = await readSettings();
    expect(settings).toMatchObject({ requesterName: "Ada Lovelace", requesterAffiliation: "Analytical Engine Lab", requestLanguage: "es" });
    expect(await languageOf("pt-BR")).toBe("es");
  });

  it("drops stored values of the wrong shape", async () => {
    store[SETTINGS_STORAGE_KEY] = { requesterName: 7, requesterAffiliation: { a: 1 }, requestLanguage: "fr" };
    Object.defineProperty(globalThis, "navigator", { value: { language: "pt-PT" }, configurable: true });
    expect(await readSettings()).toMatchObject({ requesterName: "", requesterAffiliation: "", requestLanguage: "pt" });
  });
});

describe("settings sidebar sections", () => {
  it("defaults to both sections", async () => {
    expect((await readSettings()).sidebarSections).toEqual({ library: true, projects: true });
  });

  it("reads back a saved choice and repairs a stored one that hides everything", async () => {
    await updateSettings({ sidebarSections: { library: false, projects: true } });
    expect((await readSettings()).sidebarSections).toEqual({ library: false, projects: true });
    store[SETTINGS_STORAGE_KEY] = { sidebarSections: { library: false, projects: false } };
    expect((await readSettings()).sidebarSections).toEqual({ library: true, projects: true });
  });
});

describe("settings build options", () => {
  it("defaults to compiling while typing and trying despite errors", async () => {
    expect(await readSettings()).toMatchObject({ autoCompile: "typing", haltOnError: false });
  });

  it("reads back a saved choice and drops stored values of the wrong shape", async () => {
    await updateSettings({ autoCompile: "save", haltOnError: true });
    expect(await readSettings()).toMatchObject({ autoCompile: "save", haltOnError: true });
    store[SETTINGS_STORAGE_KEY] = { autoCompile: "sometimes", haltOnError: "yes" };
    expect(await readSettings()).toMatchObject({ autoCompile: "typing", haltOnError: false });
  });
});
