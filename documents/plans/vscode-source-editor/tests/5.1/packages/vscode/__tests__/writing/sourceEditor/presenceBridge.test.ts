/** Pins that the LabShelf editor's presence bridge converts offsets between the webview's LF text and the document's own line break. */
import * as vscode from 'vscode';
import { createSourcePresence, type PeerSelection } from '../../../src/writing/sourceEditor/presenceBridge';

type SourceEditorInbound = Parameters<Parameters<typeof createSourcePresence>[0]['post']>[0];

// vscode.EndOfLine values
const LF = 1;
const CRLF = 2;

function setup(text: string, eol: number) {
  const uri = vscode.Uri.file('/project/main.tex');
  const document = { uri, getText: () => text, eol } as unknown as Pick<vscode.TextDocument, 'uri' | 'getText' | 'eol'>;
  const publish = jest.fn();
  const posted: SourceEditorInbound[] = [];
  let listener: ((peers: PeerSelection[]) => void) | undefined;
  const unsubscribe = jest.fn();
  const subscribePeers = jest.fn((_uri: vscode.Uri, next: (peers: PeerSelection[]) => void) => {
    listener = next;
    return unsubscribe;
  });
  const bridge = createSourcePresence({ document, publish, subscribePeers, post: (message) => posted.push(message) });
  const peersMessages = () => posted.filter((message): message is Extract<SourceEditorInbound, { type: 'peers' }> => message.type === 'peers');
  return { uri, bridge, publish, subscribePeers, unsubscribe, posted, peersMessages, emitPeers: (peers: PeerSelection[]) => listener?.(peers) };
}

describe('createSourcePresence', () => {
  it('5.1a publishes a selection message on the document uri', () => {
    const { bridge, publish, uri } = setup('abc\ndef', LF);
    bridge.selection({ type: 'selection', anchor: 1, head: 5, line: 1 });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(uri, { anchor: 1, head: 5 });
  });

  it('5.1a publishes a collapsed cursor as equal anchor and head', () => {
    const { bridge, publish, uri } = setup('abc', LF);
    bridge.selection({ type: 'selection', anchor: 2, head: 2, line: 0 });
    expect(publish).toHaveBeenCalledWith(uri, { anchor: 2, head: 2 });
  });

  it('5.1a converts LF offsets to document offsets in a CRLF document', () => {
    // "a\r\nb": b is LF offset 2 and document offset 3
    const { bridge, publish, uri } = setup('a\r\nb', CRLF);
    bridge.selection({ type: 'selection', anchor: 2, head: 2, line: 1 });
    expect(publish).toHaveBeenCalledWith(uri, { anchor: 3, head: 3 });
  });

  it('5.1a counts every earlier line break of a CRLF document when publishing', () => {
    // LF text "ab\ncd\nef": e is LF offset 6, document offset 8
    const { bridge, publish, uri } = setup('ab\r\ncd\r\nef', CRLF);
    bridge.selection({ type: 'selection', anchor: 1, head: 6, line: 2 });
    expect(publish).toHaveBeenCalledWith(uri, { anchor: 1, head: 8 });
  });

  it('5.1b subscribes to the peers of the document uri', () => {
    const { subscribePeers, uri } = setup('abc', LF);
    expect(subscribePeers).toHaveBeenCalledTimes(1);
    expect(subscribePeers.mock.calls[0]?.[0]).toBe(uri);
  });

  it('5.1b posts peers with their offsets unchanged in an LF document', () => {
    const { emitPeers, peersMessages } = setup('abc\ndef', LF);
    emitPeers([{ name: 'Ada', colour: '#ff0000', anchor: 1, head: 5 }]);
    expect(peersMessages().at(-1)).toEqual({ type: 'peers', peers: [{ name: 'Ada', colour: '#ff0000', anchor: 1, head: 5 }] });
  });

  it('5.1b posts peers with LF offsets for a CRLF document', () => {
    // document offset 3 is the b in "a\r\nb", LF offset 2
    const { emitPeers, peersMessages } = setup('a\r\nb', CRLF);
    emitPeers([{ name: 'Ada', colour: '#ff0000', anchor: 3, head: 4 }]);
    expect(peersMessages().at(-1)).toEqual({ type: 'peers', peers: [{ name: 'Ada', colour: '#ff0000', anchor: 2, head: 3 }] });
  });

  it('5.1b converts each peer on its own in a CRLF document', () => {
    // LF text "ab\ncd\nef"; document offsets 0, 4 (c) and 8 (e)
    const { emitPeers, peersMessages } = setup('ab\r\ncd\r\nef', CRLF);
    emitPeers([
      { name: 'Ada', colour: '#111111', anchor: 0, head: 4 },
      { name: 'Bo', colour: '#222222', anchor: 8, head: 8 },
    ]);
    expect(peersMessages().at(-1)?.peers).toEqual([
      { name: 'Ada', colour: '#111111', anchor: 0, head: 3 },
      { name: 'Bo', colour: '#222222', anchor: 6, head: 6 },
    ]);
  });

  it('5.1b posts an empty peers list when the last peer leaves', () => {
    const { emitPeers, peersMessages } = setup('abc', LF);
    emitPeers([{ name: 'Ada', colour: '#ff0000', anchor: 0, head: 0 }]);
    emitPeers([]);
    expect(peersMessages().at(-1)).toEqual({ type: 'peers', peers: [] });
  });

  it('5.1b stops listening to peers on dispose', () => {
    const { bridge, unsubscribe } = setup('abc', LF);
    bridge.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
