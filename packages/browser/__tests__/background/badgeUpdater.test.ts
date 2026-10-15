/**
 * Toolbar badge: the colours come from the core design tokens, and the idle state
 * sets no colour because its badge text is empty.
 */
const mockAction = {
  setBadgeBackgroundColor: jest.fn(async (_details: { color: string }) => undefined),
  setBadgeText: jest.fn(async (_details: { text: string }) => undefined),
  setTitle: jest.fn(async (_details: { title: string }) => undefined),
};
jest.mock("../../src/platform", () => ({
  bx: {
    action: {
      setBadgeBackgroundColor: (details: { color: string }) => mockAction.setBadgeBackgroundColor(details),
      setBadgeText: (details: { text: string }) => mockAction.setBadgeText(details),
      setTitle: (details: { title: string }) => mockAction.setTitle(details),
    },
  },
}));

import { COLOR_TOKENS, type DriveStatus } from "@labshelf/core";
import { installBadgeUpdater } from "../../src/background/badgeUpdater";

const idle: DriveStatus = { connected: true, syncing: false, lastSyncTime: null, lastError: null };

/** Installs the updater against a fixed status and returns the badge calls of its first tick. */
function firstTick(status: DriveStatus): void {
  installBadgeUpdater(() => status);
}

beforeEach(() => {
  jest.useFakeTimers();
  mockAction.setBadgeBackgroundColor.mockClear();
  mockAction.setBadgeText.mockClear();
  mockAction.setTitle.mockClear();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("installBadgeUpdater", () => {
  it("paints the syncing badge in the core blue token", () => {
    firstTick({ ...idle, syncing: true });
    expect(mockAction.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: COLOR_TOKENS.blue.value });
    expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: expect.any(String) });
  });

  it("paints the error badge in the core error token", () => {
    firstTick({ ...idle, lastError: "Drive offline" });
    expect(mockAction.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: COLOR_TOKENS.error.value });
    expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "!" });
  });

  it("clears the text and sets no colour when idle and connected", () => {
    firstTick(idle);
    expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "" });
    expect(mockAction.setBadgeBackgroundColor).not.toHaveBeenCalled();
  });
});
