import * as vscode from 'vscode';

import { createLibraryEvents } from '../../../src/events/index.js';
import type { ActiveServices } from '../../../src/commands/index.js';

const buildServices = jest.fn();
jest.mock('../../../src/activation/serviceComposition/index.js', () => ({
  buildServices: (...args: unknown[]) => buildServices(...args),
  createFileSystem: jest.fn(),
}));

const runLibrarySetupWizard = jest.fn();
jest.mock('../../../src/storage/paths/index.js', () => ({
  runLibrarySetupWizard: (...args: unknown[]) => runLibrarySetupWizard(...args),
}));

import type { HostAdapters } from '../../../src/activation/serviceComposition/index.js';
import { LibraryRootController } from '../../../src/activation/libraryLifecycle/libraryRootController.js';
import { ExternalChangeHandling } from '../../../src/activation/libraryLifecycle/externalChangeHandling.js';
import { SyncControllerLifecycle } from '../../../src/activation/libraryLifecycle/syncControllerLifecycle.js';

function fakeServices(): ActiveServices {
  return { logger: { log: jest.fn(), error: jest.fn() } } as unknown as ActiveServices;
}

function fakeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

describe('LibraryRootController', () => {
  beforeEach(() => {
    buildServices.mockReset();
    runLibrarySetupWizard.mockReset();
  });

  // The watcher and the sync lifecycle are stubbed: this suite is about one rebuild path, not their wiring.
  const sharedLibraryConfig = { readRoot: jest.fn(), recordRoot: jest.fn(), path: jest.fn() };
  const adapters = { paths: {}, sharedLibraryConfig } as unknown as HostAdapters;

  function makeController(): LibraryRootController {
    const context = fakeContext();
    const events = createLibraryEvents();
    const externalChangeHandling = { watch: jest.fn() } as unknown as ExternalChangeHandling;
    const syncLifecycle = { ensure: jest.fn(async () => undefined) } as unknown as SyncControllerLifecycle;
    return new LibraryRootController(context, events, externalChangeHandling, syncLifecycle, adapters);
  }

  it('require() builds services once and caches the result', async () => {
    const services = fakeServices();
    buildServices.mockResolvedValue(services);
    runLibrarySetupWizard.mockResolvedValue(vscode.Uri.file('/library'));
    const controller = makeController();

    const first = await controller.require();
    const second = await controller.require();

    expect(first).toBe(services);
    expect(second).toBe(services);
    expect(buildServices).toHaveBeenCalledTimes(1);
    expect(runLibrarySetupWizard).toHaveBeenCalledTimes(1);
    expect(runLibrarySetupWizard).toHaveBeenCalledWith(sharedLibraryConfig, expect.any(Function));
  });

  it('reconfigure() always rebuilds, even when services are already cached', async () => {
    const first = fakeServices();
    const second = fakeServices();
    buildServices.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    runLibrarySetupWizard.mockResolvedValue(vscode.Uri.file('/library'));
    const controller = makeController();

    await controller.require();
    const result = await controller.reconfigure();

    expect(result).toBe(second);
    expect(buildServices).toHaveBeenCalledTimes(2);
  });

  it('builds services over the host adapters', async () => {
    buildServices.mockResolvedValue(fakeServices());
    const root = vscode.Uri.file('/library');

    await makeController().loadInitial(root);

    expect(buildServices).toHaveBeenCalledWith(expect.anything(), root, expect.anything(), adapters);
  });

  it('never starts the AI service itself', async () => {
    const services = fakeServices();
    buildServices.mockResolvedValue(services);
    const controller = makeController();

    await controller.loadInitial(vscode.Uri.file('/library'));

    // The controller's own surface has no AI-related method; starting it is the caller's job.
    expect((controller as unknown as Record<string, unknown>).startAiService).toBeUndefined();
    expect((controller as unknown as Record<string, unknown>).maybeStartAi).toBeUndefined();
  });
});
