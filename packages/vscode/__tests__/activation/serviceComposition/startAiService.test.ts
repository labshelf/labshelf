// startAiService skips AI when it is disabled in settings and feeds paper events to the indexer through the subscription it hands the core factory.
import * as vscode from "vscode";
import { createAiService } from "@labshelf/core";
import { createLibraryEvents } from "../../../src/events/index.js";
import { startAiService } from "../../../src/activation/serviceComposition/startAiService.js";
import type { ActiveServices } from "../../../src/commands/index.js";
import type { HostAdapters } from "../../../src/activation/serviceComposition/hostAdapters.js";

jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), createAiService: jest.fn() }));

function setup() {
  const services = {
    logger: { log: jest.fn(), error: jest.fn() },
    paperService: { listPapers: jest.fn(), resolvePdfPath: jest.fn() },
    fileSystem: {},
    aiDatabasePath: "/db",
  } as unknown as ActiveServices;
  const adapters = { openAiStorage: jest.fn(async () => ({})), pdfOpener: {} } as unknown as HostAdapters;
  const context = { subscriptions: [] as Array<{ dispose: () => void }> };
  return { services, adapters, context, events: createLibraryEvents() };
}

describe("startAiService", () => {
  it("returns null without opening storage when AI is disabled in settings", async () => {
    const { services, adapters, context, events } = setup();
    jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({ get: () => false } as never);

    expect(await startAiService(context as never, events, services, adapters)).toBeNull();
    expect(adapters.openAiStorage).not.toHaveBeenCalled();
    expect(createAiService).not.toHaveBeenCalled();
  });

  it("maps added, updated and deleted events to upsert and remove ids, and stops after the disposer runs", async () => {
    const { services, adapters, context, events } = setup();
    jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({ get: () => true } as never);
    const service = { tag: "service" };
    (createAiService as jest.Mock).mockReturnValue({ service, dispose: jest.fn() });

    expect(await startAiService(context as never, events, services, adapters)).toBe(service);

    const { subscribe } = (createAiService as jest.Mock).mock.calls[0][0];
    const onUpsert = jest.fn();
    const onRemove = jest.fn();
    const dispose = subscribe(onUpsert, onRemove);
    events.paperAdded.fire({ id: "a" } as never);
    events.paperUpdated.fire({ id: "b" } as never);
    events.paperDeleted.fire({ id: "c" });
    expect(onUpsert.mock.calls).toEqual([["a"], ["b"]]);
    expect(onRemove.mock.calls).toEqual([["c"]]);

    dispose();
    events.paperAdded.fire({ id: "d" } as never);
    expect(onUpsert).toHaveBeenCalledTimes(2);
    expect(context.subscriptions).toHaveLength(1);
  });
});
