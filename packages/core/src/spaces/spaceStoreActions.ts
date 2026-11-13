// Applies the Spaces page's changes to the Space store: the Space mutations, and the note and thread item changes with the posts of the
// file and folder lists they move.
import type { SpaceMutation } from "./spaceMutationParse.js";
import type { HostToSpaces, SpaceQmdAction } from "./spacesProtocol.js";
import type { SpaceStore } from "./spaceStore.js";

type Post = (message: HostToSpaces) => void;
type NotesAndThreads = Pick<SpaceStore, "notes" | "discussions" | "list">;

/** Resolves to the new id for the mutations that create something; `author` is who saves and records. */
export function applySpaceMutation(store: SpaceStore, m: SpaceMutation, author: string): Promise<unknown> {
  switch (m.type) {
    case "createSpace": return store.createSpace(m.name);
    case "renameSpace": return store.renameSpace(m.id, m.name);
    case "setPurpose": return store.setPurpose(m.id, m.purpose);
    case "deleteSpace": return store.deleteSpace(m.id);
    case "setArchived": return store.setArchived(m.id, m.archived);
    case "setTrashed": return store.setTrashed(m.id, m.trashed);
    case "setIcon": return store.setIcon(m.id, m.icon);
    case "addPapers": return store.addPapers(m.id, m.paperIds, m.folder);
    case "removePaper": return store.removePaper(m.id, m.paperId);
    case "pinToDesk": return store.pinToDesk(m.id, m.kind, m.ref);
    case "unpinFromDesk": return store.unpinFromDesk(m.id, m.kind, m.ref);
    case "moveReference": return store.moveReference(m.id, m.paperId, m.folder);
    case "createFolder": return store.createFolder(m.id, m.name, m.parent);
    case "renameFolder": return store.renameFolder(m.id, m.folderId, m.name);
    case "deleteFolder": return store.deleteFolder(m.id, m.folderId);
    case "linkProject": return store.linkProject(m.id, m.projectId);
    case "unlinkProject": return store.unlinkProject(m.id, m.projectId);
    case "addDate": return store.addDate(m.id, m.date);
    case "updateDate": return store.updateDate(m.id, m.dateId, m.date);
    case "removeDate": return store.removeDate(m.id, m.dateId);
    case "setDone": return store.setDone(m.id, m.dateId, m.done);
    case "addTerm": return store.addTerm(m.id, m.term);
    case "updateTerm": return store.updateTerm(m.id, m.termId, m.term);
    case "removeTerm": return store.removeTerm(m.id, m.termId);
    case "toggleSaved": return store.toggleSaved(m.id, { path: m.path, itemId: m.itemId }, author);
    case "markSeen": return store.markSeen(m.id, m.path, author);
    case "addAgreement": return store.addAgreement(m.id, m.agreement, author);
    case "updateAgreement": return store.updateAgreement(m.id, m.agreementId, m.text);
    case "removeAgreement": return store.removeAgreement(m.id, m.agreementId);
  }
}

export const isThreadPath = (path: string): boolean => path.startsWith("discussions/");

/** Posts the items of one file, from the notes or the discussions store by its folder. */
export async function postQmd({ notes, discussions }: NotesAndThreads, post: Post, spaceId: string, path: string): Promise<void> {
  const items = await (isThreadPath(path) ? discussions : notes).read(spaceId, path);
  post({ type: "spaceQmd", spaceId, path, items });
}

export async function postNotes({ notes }: NotesAndThreads, post: Post, spaceId: string): Promise<void> {
  post({ type: "spaceNotes", spaceId, notes: await notes.list(spaceId) });
}

/** Lists the threads with `unread` for `author`, from the `seen` of the Space as last read. */
export async function postThreads(stores: NotesAndThreads, post: Post, spaceId: string, author: string): Promise<void> {
  const read = stores.list().find((result) => result.state === "ready" && result.space.id === spaceId);
  const seen = read?.state === "ready" ? read.space.seen ?? [] : [];
  post({ type: "spaceDiscussions", spaceId, threads: await stores.discussions.list(spaceId, { author, seen }) });
}

/** Posts the list of the folder the file is in, whose title, count or status the change may have moved. */
export function postListOf(stores: NotesAndThreads, post: Post, spaceId: string, path: string, author: string): Promise<void> {
  return isThreadPath(path) ? postThreads(stores, post, spaceId, author) : postNotes(stores, post, spaceId);
}

type ItemChange = Extract<SpaceQmdAction, { type: "addSpaceItem" | "editSpaceItem" | "removeSpaceItem" | "setThreadStatus" }>;

/** Applies the change to the notes or the discussions store by the folder of its path. */
async function changeItem({ notes, discussions }: NotesAndThreads, author: string, m: ItemChange): Promise<void> {
  const thread = isThreadPath(m.path);
  switch (m.type) {
    case "addSpaceItem":
      await (thread ? discussions.addMessage(m.spaceId, m.path, m.body, author) : notes.addItem(m.spaceId, m.path, m.body, author));
      return;
    case "editSpaceItem":
      // An edit from the page is the author's, so it is stamped; a cell output write (runSpaceCell) never is.
      await (thread ? discussions.editMessage(m.spaceId, m.path, m.id, m.body, { edited: new Date().toISOString() }) : notes.editItem(m.spaceId, m.path, m.id, m.body));
      return;
    case "removeSpaceItem":
      await (thread ? discussions.removeMessage(m.spaceId, m.path, m.id) : notes.removeItem(m.spaceId, m.path, m.id));
      return;
    case "setThreadStatus": await discussions.setStatus(m.spaceId, m.path, m.status);
  }
}

export async function runQmdAction(stores: NotesAndThreads, author: string, post: Post, m: SpaceQmdAction): Promise<void> {
  switch (m.type) {
    case "createSpaceNote": await stores.notes.create(m.spaceId, m.title); return postNotes(stores, post, m.spaceId);
    case "createSpaceThread": await stores.discussions.create(m.spaceId, m.title, m.body, author); return postThreads(stores, post, m.spaceId, author);
    case "readSpaceQmd": return postQmd(stores, post, m.spaceId, m.path);
    case "searchDiscussions":
      post({ type: "discussionSearch", spaceId: m.spaceId, query: m.query, hits: await stores.discussions.search(m.spaceId, m.query) });
      return;
    case "setThreadStatus": await changeItem(stores, author, m); return postThreads(stores, post, m.spaceId, author);
    default:
      await changeItem(stores, author, m);
      await postQmd(stores, post, m.spaceId, m.path);
      return postListOf(stores, post, m.spaceId, m.path, author);
  }
}
