// Runs one Spaces page mutation on the Space store.
import type { SpaceStore } from "./store/index.js";
import type { SpaceMutation } from "./protocol/index.js";

/** Resolves to the new id for the mutations that create something. */
export function applySpaceMutation(store: SpaceStore, m: SpaceMutation): Promise<unknown> {
  switch (m.type) {
    case "createSpace": return store.createSpace(m.name);
    case "renameSpace": return store.renameSpace(m.id, m.name);
    case "setPurpose": return store.setPurpose(m.id, m.purpose);
    case "deleteSpace": return store.deleteSpace(m.id);
    case "addPapers": return store.addPapers(m.id, m.paperIds, m.folder);
    case "removePaper": return store.removePaper(m.id, m.paperId);
    case "setFocus": return store.setFocus(m.id, m.paperId, m.focus);
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
  }
}
