// The consult windows' ports in the LabShelf Editor webview: the client and the file opener over 9.1's consult envelopes, answered by the extension host (consultFiles.ts).
import type { ConsultClient, EditableFile, EditableFileOpener } from "@labshelf/core/consult";
import type { ConsultDocInbound, ConsultReply, ConsultFileInit, ConsultInbound, ConsultOutbound } from "@labshelf/core";
import { createHostDocument } from "./hostDocument.js";

type FileReply = ConsultFileInit | { error: string };
type Deliver = (message: ConsultDocInbound) => void;

export function createWebviewConsult(post: (message: ConsultOutbound) => void): { client: ConsultClient; openFile: EditableFileOpener; receive(message: ConsultInbound): void } {
  let nextId = 0;
  let nextKey = 0;
  const requests = new Map<number, (reply: ConsultReply) => void>();
  const files = new Map<number, (file: FileReply) => void>();
  /** Each open file's document messages, by key; a released key is dropped. */
  const routes = new Map<string, Deliver>();

  const client: ConsultClient = (request) => new Promise((resolve) => {
    const id = nextId++;
    requests.set(id, resolve);
    post({ type: "consult", id, request });
  });

  const bind = (key: string, init: ConsultFileInit): EditableFile => {
    let released = false;
    const release = (): void => {
      if (released) { return; }
      released = true;
      routes.delete(key);
      post({ type: "consultRelease", key });
    };
    const send = (message: Extract<ConsultOutbound, { type: "consultDoc" }>["message"]): void => { post({ type: "consultDoc", key, message }); };
    if (init.kind === "text") {
      const host = createHostDocument(init, send);
      routes.set(key, (message) => {
        if (message.type === "updates" || message.type === "resync" || message.type === "dirty") { host.deliver(message); }
      });
      return { kind: "text", path: init.path, binding: { document: host.document }, release };
    }
    const listeners = new Set<(text: string) => void>();
    routes.set(key, (message) => {
      if (message.type !== "update") { return; }
      for (const listener of [...listeners]) { listener(message.text); }
    });
    return {
      kind: "qmd", path: init.path,
      binding: {
        text: init.text,
        save: async (itemId, body) => { send({ type: "saveItem", itemId, body }); },
        create: async (itemId, body) => { send({ type: "createItem", itemId, body }); },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      },
      release,
    };
  };

  const openFile: EditableFileOpener = (ref) => new Promise<EditableFile>((resolve, reject) => {
    const id = nextId++;
    const key = `consult-${nextKey++}`;
    files.set(id, (file) => {
      if ("error" in file) { reject(new Error(file.error)); return; }
      resolve(bind(key, file));
    });
    post({ type: "consultFile", id, key, ref });
  });

  return {
    client, openFile,
    receive(message) {
      if (message.type === "consultReply") {
        const resolve = requests.get(message.id);
        if (!resolve) { return; }
        requests.delete(message.id);
        resolve(message.reply);
      } else if (message.type === "consultFileReply") {
        const settle = files.get(message.id);
        if (!settle) { return; }
        files.delete(message.id);
        settle(message.file);
      } else {
        routes.get(message.key)?.(message.message);
      }
    },
  };
}
