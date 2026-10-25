// Builds the static layout of the Publish screen: heading, back button, form column and preview column.
import { icon } from "../../ui/index.js";
import { el } from "../../ui/dom/index.js";
import type { PublishProject } from "../protocol/index.js";

export interface PublishLayoutParts {
  project: PublishProject;
  headingId: string;
  onBack(): void;
  /** The form, check list and GitHub step, in reading order. */
  workflow: HTMLElement[];
  done: HTMLElement;
}

export interface PublishLayout {
  element: HTMLElement;
  heading: HTMLElement;
  preview: HTMLElement;
  /** Shows the result in place of the workflow, or the workflow again. */
  showResult(shown: boolean): void;
}

export function buildPublishLayout(parts: PublishLayoutParts): PublishLayout {
  const { project, headingId, done } = parts;
  const title = `Publish “${project.title}” as a template`;
  const heading = el("h1", { id: headingId, class: "ls-tpl-detail-title ls-tpl-publish-title", tabindex: -1, text: title, title });
  const back = el("button", { class: "ls-btn", type: "button" }, el("span", { html: icon("arrow-left") }), "Templates");
  back.addEventListener("click", parts.onBack);
  const preview = el("figure", { class: "ls-tpl-preview" });
  const workflow = el("div", { class: "ls-tpl-publish-workflow" }, ...parts.workflow);
  done.hidden = true;

  const element = el("section", { class: "ls-tpl-detail ls-tpl-publish", "aria-labelledby": headingId },
    el("div", { class: "ls-tpl-detail-nav" }, back),
    el("div", { class: "ls-tpl-detail-body" },
      el("div", { class: "ls-tpl-info" },
        heading,
        el("p", { class: "ls-tpl-description", text: "LabShelf copies the project’s source files. Your text stays out unless you keep it in the sample." }),
        workflow, done),
      el("div", { class: "ls-tpl-publish-aside" }, preview,
        el("p", { class: "ls-tpl-publish-caption", text: `Compiled on this machine with ${project.engineLabel}` }),
        el("p", { class: "ls-tpl-publish-caption", text: "The thumbnail and a sample PDF go with the submission, so the catalog never has to compile it." }))));

  return {
    element, heading, preview,
    showResult(shown) {
      workflow.hidden = shown;
      done.hidden = !shown;
    },
  };
}
