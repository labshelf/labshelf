// Builds a SharingHost whose operations are jest mocks, for the sharing dialog tests.
import type { ShareHost } from "../../../src/share/index.js";

export function fakeHost(over: Partial<ShareHost> = {}): jest.Mocked<ShareHost> {
  return {
    place: "this browser",
    offers: jest.fn(() => ({ projects: true, links: true })),
    onOffersChange: jest.fn(() => () => {}),
    projects: jest.fn(async () => [{ id: "p1", name: "Thesis", shared: true }]),
    projectStatus: jest.fn(async () => ({ kind: "notShared" as const })),
    shareProject: jest.fn(),
    inviteLink: jest.fn(async () => "labshelf://join#x"),
    joinProject: jest.fn(),
    leaveProject: jest.fn(async () => {}),
    openProject: jest.fn(async () => {}),
    shareableFolder: jest.fn(async () => undefined),
    shareFolder: jest.fn(),
    sharedLinks: jest.fn(async () => []),
    revokeLink: jest.fn(),
    importLink: jest.fn(),
    openFolder: jest.fn(async () => {}),
    copyText: jest.fn(async () => true),
    openLink: jest.fn(async () => {}),
    ...over,
  } as jest.Mocked<ShareHost>;
}

export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export function clickButton(label: string): void {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === label);
  if (!btn) throw new Error(`no button "${label}"`);
  btn.click();
}
