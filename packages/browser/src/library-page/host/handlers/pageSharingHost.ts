// Hands out one sharing host that adds the project half once the page's lazily loaded project wiring hands it over.
import type { ProjectSharingDeps, SharingHost } from "@labshelf/core";

export interface PageSharingHost {
  host: SharingHost;
  /** Switches `host` to one that also shares projects and tells its offers listeners. */
  addProjects(deps: ProjectSharingDeps): void;
}

/** `build` makes the host with the links half alone, or with the project half too when given its deps. */
export function createPageSharingHost(build: (projects?: ProjectSharingDeps) => SharingHost): PageSharingHost {
  let inner = build();
  const listeners = new Set<() => void>();
  const host: SharingHost = {
    place: inner.place,
    offers: () => inner.offers(),
    onOffersChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    projects: () => inner.projects(),
    projectStatus: (id) => inner.projectStatus(id),
    shareProject: (id, signal) => inner.shareProject(id, signal),
    inviteLink: (id) => inner.inviteLink(id),
    joinProject: (invite, signal) => inner.joinProject(invite, signal),
    leaveProject: (id) => inner.leaveProject(id),
    openProject: (id) => inner.openProject(id),
    shareableFolder: (path) => inner.shareableFolder(path),
    shareFolder: (path, withAnnotations, onProgress) => inner.shareFolder(path, withAnnotations, onProgress),
    sharedLinks: () => inner.sharedLinks(),
    revokeLink: (id) => inner.revokeLink(id),
    importLink: (text, onProgress) => inner.importLink(text, onProgress),
    openFolder: (path) => inner.openFolder(path),
    copyText: (text) => inner.copyText(text),
    openLink: (url) => inner.openLink(url),
  };
  return {
    host,
    addProjects(deps) {
      inner = build(deps);
      for (const listener of [...listeners]) listener();
    },
  };
}
