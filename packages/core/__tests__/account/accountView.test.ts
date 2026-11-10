/** @jest-environment jsdom */
import type { AccountPort, AccountRemoteDetails, AccountState } from "../../src/account/account.js";
import { mountAccountView } from "../../src/account/dom/accountView.js";
import { DETAILS, stateOf, viewPort } from "./accountFixtures.js";

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

function fakePort(state: AccountState): AccountPort & { saved: string[] } {
  const saved: string[] = [];
  return {
    saved,
    watch: (listener) => { listener(state); return () => undefined; },
    saveUserName: async (name) => { saved.push(name); },
    connectCloudflare: async () => undefined,
    disconnectCloudflare: async () => undefined,
    setRemoteAccess: async () => undefined,
    estimatePaperPdfs: async () => ({ bytes: 0, files: 0 }),
    setIncludePdfs: async () => undefined,
    setStorageLimit: async () => undefined,
    moveStore: async () => undefined,
  };
}

const NO_REMOTE = { available: false, on: false, busy: false };

const button = (root: HTMLElement, label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

describe("Account view", () => {
  it("shows Cloudflare as not connected with an enabled Connect", () => {
    const root = document.createElement("div");
    mountAccountView(root, fakePort({ userName: "Ada", cloudflareAvailable: true, relayUrl: undefined, remoteAccess: NO_REMOTE }));
    expect(root.textContent).toContain("Not connected");
    expect(button(root, "Connect")?.disabled).toBe(false);
    expect((root.querySelector("input[type=text]") as HTMLInputElement).value).toBe("Ada");
  });

  it("shows the relay host when connected", () => {
    const root = document.createElement("div");
    mountAccountView(root, fakePort({ userName: "Ada", cloudflareAvailable: true, relayUrl: "https://labshelf-relay.ada.workers.dev", remoteAccess: NO_REMOTE }));
    expect(root.textContent).toContain("Connected");
    expect(root.textContent).toContain("labshelf-relay.ada.workers.dev");
    expect(button(root, "Disconnect")?.disabled).toBe(false);
  });

  it("names the signed-in Cloudflare account beside the relay host", () => {
    const root = document.createElement("div");
    mountAccountView(root, fakePort({
      userName: "Ada", cloudflareAvailable: true, relayUrl: "https://labshelf-relay.ada.workers.dev", cloudflareEmail: "ada@example.org", remoteAccess: NO_REMOTE,
    }));
    expect(root.textContent).toContain("Connected as ada@example.org, with your relay at labshelf-relay.ada.workers.dev");
  });

  it("disables Connect with a Coming soon note when the app cannot connect yet, and keeps Remote access disabled", () => {
    const root = document.createElement("div");
    mountAccountView(root, fakePort({ userName: "", cloudflareAvailable: false, relayUrl: undefined, remoteAccess: NO_REMOTE }));
    expect(button(root, "Connect")?.disabled).toBe(true);
    expect(root.textContent).toContain("Coming soon");
    const remote = root.querySelector("input[role=switch]") as HTMLInputElement;
    expect(remote.disabled).toBe(true);
  });

  it("saves the trimmed user name through the port", () => {
    const root = document.createElement("div");
    const port = fakePort({ userName: "Ada", cloudflareAvailable: true, relayUrl: undefined, remoteAccess: NO_REMOTE });
    mountAccountView(root, port);
    (root.querySelector("input[type=text]") as HTMLInputElement).value = "  Ada Lovelace  ";
    button(root, "Save")!.click();
    expect(port.saved).toEqual(["Ada Lovelace"]);
  });
});

const switchOf = (root: HTMLElement): HTMLInputElement => root.querySelector("input[role=switch]") as HTMLInputElement;

describe("Account view remote access", () => {
  it("7.1a disables the switch and says to connect Cloudflare first when Cloudflare is not connected", () => {
    const root = document.createElement("div");
    mountAccountView(root, viewPort(stateOf({ available: false, on: false, busy: false }, null)));
    expect(switchOf(root).disabled).toBe(true);
    expect(root.textContent).toContain("Connect Cloudflare first");
  });

  it("7.1a disables the switch when the app has no remote access, without asking to connect Cloudflare", () => {
    const root = document.createElement("div");
    mountAccountView(root, viewPort(stateOf({ available: false, on: false, busy: false })));
    expect(switchOf(root).disabled).toBe(true);
    expect(root.textContent).not.toContain("Connect Cloudflare first");
  });

  it("7.1a drops the Coming soon placeholder text and shows the switch description", () => {
    const root = document.createElement("div");
    mountAccountView(root, viewPort(stateOf({ available: true, on: false, busy: false })));
    expect(root.textContent).not.toContain("Coming soon: open your library from any browser");
    expect(root.textContent).toContain("Open your library read-only from labshelf.org/open/ after signing in with this Cloudflare account.");
  });

  it("7.1b enables the switch when remote access is available and shows its value", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: true, busy: false }));
    mountAccountView(root, port);
    expect(switchOf(root).disabled).toBe(false);
    expect(switchOf(root).checked).toBe(true);
    port.push(stateOf({ available: true, on: false, busy: false }));
    expect(switchOf(root).checked).toBe(false);
  });

  it("7.1b toggling the switch asks the port to turn remote access on", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: false, busy: false }));
    mountAccountView(root, port);
    switchOf(root).click();
    expect(port.remoteCalls).toEqual([true]);
  });

  it("7.1b toggling an on switch asks the port to turn remote access off", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: true, busy: false }));
    mountAccountView(root, port);
    switchOf(root).click();
    expect(port.remoteCalls).toEqual([false]);
  });

  it("7.1b disables the switch while busy and enables it again after the new value arrives", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: false, busy: false }));
    mountAccountView(root, port);
    switchOf(root).click();
    port.push(stateOf({ available: true, on: false, busy: true }));
    expect(switchOf(root).disabled).toBe(true);
    port.push(stateOf({ available: true, on: true, busy: false }));
    expect(switchOf(root).disabled).toBe(false);
    expect(switchOf(root).checked).toBe(true);
  });

  it("7.1b shows the failure message and puts the switch back off", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: false, busy: false }));
    mountAccountView(root, port);
    switchOf(root).click();
    port.push(stateOf({ available: true, on: false, busy: true }));
    port.push(stateOf({ available: true, on: false, busy: false, message: "Could not reach Cloudflare" }));
    expect(switchOf(root).checked).toBe(false);
    expect(switchOf(root).disabled).toBe(false);
    expect(root.textContent).toContain("Could not reach Cloudflare");
  });

  it("7.1b hides the message once a state arrives without one", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: false, busy: false, message: "Could not reach Cloudflare" }));
    mountAccountView(root, port);
    expect(root.textContent).toContain("Could not reach Cloudflare");
    port.push(stateOf({ available: true, on: false, busy: false }));
    expect(root.textContent).not.toContain("Could not reach Cloudflare");
  });
});

describe("Account view remote store", () => {
  const withDetails = (details: Partial<AccountRemoteDetails>, busy = false): AccountState =>
    stateOf({ available: true, on: true, busy, details: { ...DETAILS, ...details } });
  const mount = (state: AccountState, port = viewPort(state)): { root: HTMLElement; port: ReturnType<typeof viewPort> } => {
    const root = document.createElement("div");
    mountAccountView(root, port);
    return { root, port };
  };
  const pdfSwitch = (root: HTMLElement): HTMLInputElement => root.querySelector("#account-include-pdfs") as HTMLInputElement;
  const visibleText = (root: HTMLElement): string =>
    [...root.querySelectorAll("p, div.settings-status, summary, li, span")].filter((el) => !el.closest("[hidden]")).map((el) => el.textContent).join(" ");
  const buttonOf = (root: HTMLElement, label: string): HTMLButtonElement =>
    [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;

  it("shows the store and its use while on, and nothing of it while off", () => {
    const { root, port } = mount(withDetails({}));
    expect(visibleText(root)).toContain("Durable Object, free");
    expect(visibleText(root)).toContain("1.2 GB of 5 GB used");
    port.push(stateOf({ available: true, on: false, busy: false }));
    expect(visibleText(root)).not.toContain("used");
  });

  it("warns at 90% and words a full store per kind with the left-out list collapsed past ten", () => {
    const { root, port } = mount(withDetails({ warn: true, used: 4_600_000_000 }));
    expect(visibleText(root)).toContain("Your remote library is almost full");
    port.push(withDetails({ warn: true, full: true, used: 5_000_000_000, leftOut: ["papers/a.pdf"] }));
    expect(visibleText(root)).toContain("Your 5 GB are full. To store more, move to R2 (needs a card on your Cloudflare account).");
    expect(visibleText(root)).not.toContain("almost full");
    expect((root.querySelector("details.account-left-out") as HTMLDetailsElement).open).toBe(true);
    const many = Array.from({ length: 12 }, (_, i) => `notes/${i}.md`);
    port.push(withDetails({ store: "r2", warn: true, full: true, used: 800_000_000, limit: 800_000_000, leftOut: many }));
    expect(visibleText(root)).toContain("Your limit of 800 MB is reached. Raise it to keep sending.");
    const list = root.querySelector("details.account-left-out") as HTMLDetailsElement;
    expect(list.open).toBe(false);
    expect(list.querySelector("summary")?.textContent).toContain("12");
    expect(list.querySelectorAll("li")).toHaveLength(12);
  });

  it("saves the limit in GB as bytes, and an empty field as the store default", async () => {
    const { root, port } = mount(withDetails({}));
    const field = root.querySelector("#account-store-limit") as HTMLInputElement;
    const save = field.closest(".setting")!.querySelector("button")!;
    expect(field.value).toBe("5");
    field.value = "2.5";
    save.click();
    await flush();
    field.value = "";
    save.click();
    await flush();
    expect(port.acted).toEqual([{ limit: 2_500_000_000 }, { limit: null }]);
  });

  it("asks with the paper PDFs size before including them; Include sends it, Cancel does not", async () => {
    const { root, port } = mount(withDetails({}));
    pdfSwitch(root).click();
    expect(pdfSwitch(root).checked).toBe(false);
    await flush();
    expect(visibleText(root)).toContain("Paper PDFs will use about 300 MB. Include them?");
    buttonOf(root, "Cancel").click();
    await flush();
    expect(visibleText(root)).not.toContain("Include them?");
    expect(port.acted).toEqual([]);
    pdfSwitch(root).click();
    await flush();
    buttonOf(root, "Include").click();
    await flush();
    expect(port.acted).toEqual([{ includePdfs: true }]);
  });

  it("turns paper PDFs off at once, and shows an estimate failure", async () => {
    const { root, port } = mount(withDetails({ includePdfs: true }), viewPort(withDetails({ includePdfs: true }), async () => { throw new Error("Could not reach the library"); }));
    pdfSwitch(root).click();
    expect(port.acted).toEqual([{ includePdfs: false }]);
    port.push(withDetails({}));
    pdfSwitch(root).click();
    await flush();
    expect(visibleText(root)).toContain("Could not reach the library");
  });

  it("explains the bucket before Move to R2, offers Move to Durable Object on R2, and disables the store while busy", () => {
    const { root, port } = mount(withDetails({}));
    expect(visibleText(root)).toContain("Create an R2 bucket named labshelf-mirror in your Cloudflare dashboard (R2 needs a card on file), then choose Move to R2.");
    expect(buttonOf(root, "Move to Durable Object").hidden).toBe(true);
    buttonOf(root, "Move to R2").click();
    expect(port.acted).toEqual([{ move: "r2" }]);
    port.push(withDetails({ store: "r2", r2Bound: true }, true));
    expect(visibleText(root)).not.toContain("Create an R2 bucket");
    expect(buttonOf(root, "Move to Durable Object").hidden).toBe(false);
    expect(buttonOf(root, "Move to Durable Object").disabled).toBe(true);
    expect(pdfSwitch(root).disabled).toBe(true);
    port.push(withDetails({ store: "r2", r2Bound: true }));
    expect(buttonOf(root, "Move to Durable Object").disabled).toBe(false);
  });
});
