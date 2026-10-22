// Pins stable per-library device identities across browser tabs and share deletion.
import "fake-indexeddb/auto";
import type { ILogger } from "@labshelf/core";
import { browserDeviceIdentity, deleteBrowserCollabState } from "../../../src/storage/collaboration";

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
afterEach(() => jest.restoreAllMocks());

it("keeps one identity across concurrent tabs, reopened stores and deleted shares", async () => {
  const first = browserDeviceIdentity("identity-library", logger);
  const second = browserDeviceIdentity("identity-library", logger);
  const [one, two] = await Promise.all([first.id(), second.id()]);
  expect(one).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(two).toBe(one);
  await deleteBrowserCollabState("identity-library/share");
  expect(await browserDeviceIdentity("identity-library", logger).id()).toBe(one);
  expect(await browserDeviceIdentity("other-library", logger).id()).not.toBe(one);
});

it("surfaces a failed identity commit and retries with durable storage", async () => {
  const put = IDBObjectStore.prototype.put;
  const failing = jest.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
    const request = put.apply(this, args);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  });
  const identity = browserDeviceIdentity("failed-identity-library", logger);
  await expect(identity.id()).rejects.toBeDefined();
  expect(logger.error).toHaveBeenCalled();
  failing.mockRestore();
  const id = await identity.id();
  expect(await browserDeviceIdentity("failed-identity-library", logger).id()).toBe(id);
});
