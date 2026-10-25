/** "Add Paper by DOI or Link…": the prompt, the import it starts and the feedback it gives. */
import * as vscode from 'vscode';

import type { ImportOutcome, PaperRecord } from '@labshelf/core';
import { addPaperByIdentifier } from '../../src/command/importCommands';
import type { ImportServices } from '../../src/command/importProgress';
import { addTextLayerJobs } from '../../src/command/textLayerQueue';

jest.mock('../../src/command/textLayerQueue', () => ({ addTextLayerJobs: jest.fn(async () => undefined) }));

const paper: PaperRecord = { id: 'lee2020study', title: 'A Study', path: '/lib/papers/lee2020study', citeKey: 'lee2020study', status: 'unread', hasPdf: true };

function services(outcome: ImportOutcome): Pick<ImportServices, 'importer' | 'textLayers' | 'logger'> & { importer: { importFromNetwork: jest.Mock } } {
  return {
    importer: { importFromNetwork: jest.fn(async () => outcome) },
    textLayers: {},
    logger: { log: jest.fn(async () => {}), error: jest.fn(async () => {}) },
  } as never;
}

beforeEach(() => jest.clearAllMocks());

describe('addPaperByIdentifier', () => {
  it('imports what was typed into papers/, then announces it and queues its text layer', async () => {
    const s = services({ status: 'added', record: paper, needsReview: false, input: '10.1000/x' });
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('  10.1000/x  ');

    await addPaperByIdentifier(s);

    expect(s.importer.importFromNetwork).toHaveBeenCalledWith('10.1000/x');
    expect((vscode.window.withProgress as jest.Mock).mock.calls[0]![0].location).toBe(vscode.ProgressLocation.Notification);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('LabShelf: Added "A Study"');
    expect(addTextLayerJobs).toHaveBeenCalledWith(s.textLayers, [paper], expect.objectContaining({ mode: 'ocr' }));
  });

  it('warns with the reason when the paper cannot be found', async () => {
    const s = services({ status: 'failed', error: 'Could not find DOI 10.1000/x', input: '10.1000/x' });
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('10.1000/x');

    await addPaperByIdentifier(s);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('LabShelf: 0 added, 1 failed: Could not find DOI 10.1000/x');
  });

  it('does nothing when the input is cancelled or blank', async () => {
    const s = services({ status: 'skipped', input: '' });
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined).mockResolvedValueOnce('   ');

    await addPaperByIdentifier(s);
    await addPaperByIdentifier(s);

    expect(s.importer.importFromNetwork).not.toHaveBeenCalled();
    expect(vscode.window.withProgress).not.toHaveBeenCalled();
  });
});
