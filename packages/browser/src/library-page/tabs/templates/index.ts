// Shows the template gallery as a workspace tab: Community, Typst Universe and My templates, each one installed as a library project and opened.
import {
  createGalleryHost, createLibraryTemplateSources, createLoopbackTransport, posixPathOps, type GalleryToHost, type HostToGallery,
} from "@labshelf/core";
import { el, mountTemplateGallery } from "@labshelf/core/dom";
import { askProjectTitle, createBrowserProjectData } from "../../projects-data";
import type { TabModule } from "../types";
import { unavailablePublish } from "./unavailablePublish";

// The bridge root is the library folder itself, so the library root path is empty.
const LIBRARY_ROOT = "";

export const mountTab: TabModule["mountTab"] = (host, _params, ctx) => {
  const { fs, logger } = ctx;
  const data = createBrowserProjectData({ fs, logger });
  const { ui, host: endpoint } = createLoopbackTransport<GalleryToHost, HostToGallery>();
  const gallery = createGalleryHost({
    sources: Object.values(createLibraryTemplateSources({ fs, paths: posixPathOps, libraryRoot: LIBRARY_ROOT, fetch: (url, init) => fetch(url, init), logger })),
    // TRAP: the engines live in the helper, which this tab does not reach yet; a refused probe shows no engine problem.
    engines: () => Promise.reject(new Error("The template gallery cannot probe build engines in the browser yet.")),
    logger,
    post: (message) => endpoint.post(message),
    askTitle: askProjectTitle,
    createProject: async (title, template, files) => { await ctx.project().session.openProject(await data.createProjectFromTemplate(LIBRARY_ROOT, { title, template, files })); },
    publish: unavailablePublish((message) => endpoint.post(message)),
  });
  const stop = endpoint.subscribe((message) => { void gallery.handle(message); });
  const body = host.appendChild(el("div", { class: "ls-workspace-fill" }));
  const page = mountTemplateGallery(body, ui);
  return { dispose: () => { stop(); gallery.dispose(); page.dispose(); body.remove(); } };
};
