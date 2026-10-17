import * as vscode from 'vscode';

import { createLibraryEvents } from '../../../src/events/index.js';
import type { ActiveServices } from '../../../src/commands/index.js';

const buildServices = jest.fn();
jest.mock('../../../src/activation/serviceComposition/index.js', () => ({
  buildServices: (...args: unknown[]) => buildServices(...args),
  createFileSystem: jest.fn(),
}));

import type { HostAdapters } from '../../../src/activation/serviceComposition/index.js';
import { LibraryRootController } from '../../../src/activation/libraryLifecycle/libraryRootController.js';
import { ExternalChangeHandling } from '../../../src/activation/libraryLifecycle/externalChangeHandling.js';

function fakeServices(): ActiveServices {
  return { logger: { log: jest.fn(), error: jest.fn() } } as unknown as ActiveServices;
}

function fakeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

describe('LibraryRootController', () => {
  beforeEach(() => {
    buildServices.mockReset();
    chooseRoot.mockReset();
  });

  // The watcher is stubbed: this suite is about one rebuild path, not its wiring.
  const sharedLibraryConfig = { readRoot: jest.fn(), recordRoot: jest.fn(), path: jest.fn() };
  const adapters = { paths: {}, sharedLibraryConfig } as unknown as HostAdapters;

  const chooseRoot = jest.fn();

  function makeController(): LibraryRootController {
    const context = fakeContext();
    const events = createLibraryEvents();
    const externalChangeHandling = { watch: jest.fn() } as unknown as ExternalChangeHandling;
    return new LibraryRootController(context, events, externalChangeHandling, adapters, chooseRoot);
  }

  it('require() builds services once and caches the result', async () => {
    const services = fakeServices();
    buildServices.mockResolvedValue(services);
    chooseRoot.mockResolvedValue(vscode.Uri.file('/library'));
    const controller = makeController();

    const first = await controller.require();
    const second = await controller.require();

    expect(first).toBe(services);
    expect(second).toBe(services);
    expect(buildServices).toHaveBeenCalledTimes(1);
    expect(chooseRoot).toHaveBeenCalledTimes(1);
  });

  it('reconfigure() always rebuilds, even when services are already cached', async () => {
    const first = fakeServices();
    const second = fakeServices();
    buildServices.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    chooseRoot.mockResolvedValue(vscode.Uri.file('/library'));
    const controller = makeController();

    await controller.require();
    const result = await controller.reconfigure();

    expect(result).toBe(second);
    expect(buildServices).toHaveBeenCalledTimes(2);
  });

  it('builds services over the host adapters', async () => {
    buildServices.mockResolvedValue(fakeServices());
    const root = vscode.Uri.file('/library');

    await makeController().applyRoot(root);

    expect(buildServices).toHaveBeenCalledWith(expect.anything(), root, expect.anything(), adapters);
  });

  it('reconfigure() leaves the open library alone when the question is cancelled', async () => {
    buildServices.mockResolvedValue(fakeServices());
    chooseRoot.mockResolvedValue(undefined);
    const controller = makeController();
    await controller.applyRoot(vscode.Uri.file('/library'));

    expect(await controller.reconfigure()).toBeNull();
    expect(controller.currentRoot()?.fsPath).toBe('/library');
    expect(buildServices).toHaveBeenCalledTimes(1);
  });

  it('never starts the AI service itself', async () => {
    const services = fakeServices();
    buildServices.mockResolvedValue(services);
    const controller = makeController();

    await controller.applyRoot(vscode.Uri.file('/library'));

    // The controller's own surface has no AI-related method; starting it is the caller's job.
    expect((controller as unknown as Record<string, unknown>).startAiService).toBeUndefined();
    expect((controller as unknown as Record<string, unknown>).maybeStartAi).toBeUndefined();
  });
});
