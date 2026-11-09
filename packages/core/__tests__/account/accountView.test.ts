/** @jest-environment jsdom */
import type { AccountPort, AccountState } from "../../src/account/account.js";
import { mountAccountView } from "../../src/account/dom/accountView.js";

function fakePort(state: AccountState): AccountPort & { saved: string[] } {
  const saved: string[] = [];
  return {
    saved,
    watch: (listener) => { listener(state); return () => undefined; },
    saveUserName: async (name) => { saved.push(name); },
    connectCloudflare: async () => undefined,
    disconnectCloudflare: async () => undefined,
  };
}

const button = (root: HTMLElement, label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

describe("Account view", () => {
  it("shows Cloudflare as not connected with an enabled Connect", () => {
    const root = document.createElement("div");
    mountAccountView(root, fakePort({ userName: "Ada", cloudflareAvailable: true, relayUrl: undefined }));
    expect(root.textContent).toContain("Not connected");
    expect(button(root, "Connect")?.disabled).toBe(false);
    expect((root.querySelector("input[type=text]") as HTMLInputElement).value).toBe("Ada");
  });

  it("shows the relay host when connected", () => {
    const root = document.createElement("div");
    mountAccountView(root, fakePort({ userName: "Ada", cloudflareAvailable: true, relayUrl: "https://labshelf-relay.ada.workers.dev" }));
    expect(root.textContent).toContain("Connected");
    expect(root.textContent).toContain("labshelf-relay.ada.workers.dev");
    expect(button(root, "Disconnect")?.disabled).toBe(false);
  });

  it("disables Connect with a Coming soon note when the app cannot connect yet, and keeps Remote access off", () => {
    const root = document.createElement("div");
    mountAccountView(root, fakePort({ userName: "", cloudflareAvailable: false, relayUrl: undefined }));
    expect(button(root, "Connect")?.disabled).toBe(true);
    expect(root.textContent).toContain("Coming soon");
    const remote = root.querySelector("input[role=switch]") as HTMLInputElement;
    expect(remote.disabled).toBe(true);
    expect(root.textContent).toContain("Coming soon: open your library from any browser");
  });

  it("saves the trimmed user name through the port", () => {
    const root = document.createElement("div");
    const port = fakePort({ userName: "Ada", cloudflareAvailable: true, relayUrl: undefined });
    mountAccountView(root, port);
    (root.querySelector("input[type=text]") as HTMLInputElement).value = "  Ada Lovelace  ";
    button(root, "Save")!.click();
    expect(port.saved).toEqual(["Ada Lovelace"]);
  });
});
