// Shows the template gallery as a workspace tab: Community, Typst Universe and My templates, each one installed as a library project and opened.
import {
  createGalleryHost, createLibraryTemplateSources, createLoopbackTransport, posixPathOps, type GalleryToHost, type HostToGallery,
} from "@labshelf/core";
import { renderElement, mountTemplateGallery, pickQuickEntry } from "@labshelf/core/dom";
import { askProjectTitle, createBrowserProjectData } from "../../writing/project";
import type { TabModule } from "./tabKind";
import { createBrowserPublish } from "../../templates";
import { createBrowserLatexHelper } from "../../helper/client";

// The bridge root is the library folder itself, so the library root path is empty.
const LIBRARY_ROOT = "";

export const mountTab: TabModule["mountTab"] = (host, _params, ctx) => {
  const { fs, logger } = ctx;
  const data = createBrowserProjectData({ fs, logger });
  const { ui, host: endpoint } = createLoopbackTransport<GalleryToHost, HostToGallery>();
  const publish = createBrowserPublish({ helper: createBrowserLatexHelper(logger), logger, post: (message) => endpoint.post(message),
    pickProject: async () => {
      const entries = (await data.listProjects(LIBRARY_ROOT)).filter((project) => project.kind === "ready");
      if (!entries.length) throw new Error("Create a writing project to publish as a template.");
      return pickQuickEntry(entries.map((project) => ({ label: project.settings.title ?? project.settings.id, value: project.settings.id })), { title: "Project to publish as a template" });
    },
  });
  const gallery = createGalleryHost({
    sources: Object.values(createLibraryTemplateSources({ fs, paths: posixPathOps, libraryRoot: LIBRARY_ROOT, fetch: (url, init) => fetch(url, init), logger })),
    // TRAP: the engines live in the helper, which this tab does not reach yet; a refused probe shows no engine problem.
    engines: () => Promise.reject(new Error("The template gallery cannot probe build engines in the browser yet.")),
    logger,
    post: (message) => endpoint.post(message),
    askTitle: askProjectTitle,
    createProject: async (title, template, files) => { await ctx.project().session.openProject(await data.createProjectFromTemplate(LIBRARY_ROOT, { title, template, files })); },
    publish,
  });
  const stop = endpoint.subscribe((message) => { void gallery.handle(message); });
  const body = host.appendChild(renderElement("div", { class: "ls-workspace-fill" }));
  const page = mountTemplateGallery(body, ui);
  return { dispose: () => { stop(); publish.dispose(); gallery.dispose(); page.dispose(); body.remove(); } };
};
