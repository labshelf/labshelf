// Renders the Publish screen: form, checks, GitHub step and result on the left, the compiled preview on the right.
import type {
  GalleryToHost,
  GalleryTransport,
  HostToGallery,
  PublishDraft,
  PublishProject,
  PublishCheckResult,
} from "../protocol/index.js";
import { fillThumb } from "./templateCard.js";
import { createCheckList } from "./checkList.js";
import { createGithubStep } from "./githubStep.js";
import { createPublishForm } from "./publishForm.js";
import { renderIcon } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { PUBLISH_CHECK_IDS } from "../publishCheckLabels.js";

interface PublishLayoutParts {
  project: PublishProject;
  headingId: string;
  onBack(): void;
  /** The form, check list and GitHub step, in reading order. */
  workflow: HTMLElement[];
  done: HTMLElement;
}

interface PublishLayout {
  element: HTMLElement;
  heading: HTMLElement;
  preview: HTMLElement;
  /** Shows the result in place of the workflow, or the workflow again. */
  showResult(shown: boolean): void;
}

function buildPublishLayout(parts: PublishLayoutParts): PublishLayout {
  const { project, headingId, done } = parts;
  const title = `Publish “${project.title}” as a template`;
  const heading = renderElement("h1", { id: headingId, class: "ls-tpl-detail-title ls-tpl-publish-title", tabindex: -1, text: title, title });
  const back = renderElement("button", { class: "ls-btn", type: "button" }, renderElement("span", { html: renderIcon("arrow-left") }), "Templates");
  back.addEventListener("click", parts.onBack);
  const preview = renderElement("figure", { class: "ls-tpl-preview" });
  const workflow = renderElement("div", { class: "ls-tpl-publish-workflow" }, ...parts.workflow);
  done.hidden = true;

  const element = renderElement("section", { class: "ls-tpl-detail ls-tpl-publish", "aria-labelledby": headingId },
    renderElement("div", { class: "ls-tpl-detail-nav" }, back),
    renderElement("div", { class: "ls-tpl-detail-body" },
      renderElement("div", { class: "ls-tpl-info" },
        heading,
        renderElement("p", { class: "ls-tpl-description", text: "LabShelf copies the project’s source files. Your text stays out unless you keep it in the sample." }),
        workflow, done),
      renderElement("div", { class: "ls-tpl-publish-aside" }, preview,
        renderElement("p", { class: "ls-tpl-publish-caption", text: `Compiled on this machine with ${project.engineLabel}` }),
        renderElement("p", { class: "ls-tpl-publish-caption", text: "The thumbnail and a sample PDF go with the submission, so the catalog never has to compile it." }))));

  return {
    element, heading, preview,
    showResult(shown) {
      workflow.hidden = shown;
      done.hidden = !shown;
    },
  };
}

interface PublishState {
  results: PublishCheckResult[];
  running: boolean;
  login: string | undefined;
  signingIn: boolean;
  submitting: boolean;
  error: string | undefined;
  thumbnail: string | undefined;
}

type PublishOutcome = "updated" | "signedIn" | "submitted" | "ignored";

const initialPublishState = (): PublishState => ({
  results: [], running: false, login: undefined, signingIn: false, submitting: false, error: undefined, thumbnail: undefined,
});

const allChecksPassed = (state: PublishState): boolean =>
  PUBLISH_CHECK_IDS.every((id) => state.results.find((r) => r.id === id)?.ok === true);

function applyHostMessage(state: PublishState, message: HostToGallery): PublishOutcome {
  switch (message.type) {
    case "publish.checks":
      state.results = message.checks;
      state.running = message.running;
      if (message.thumbnail !== undefined) state.thumbnail = message.thumbnail;
      return "updated";
    case "publish.auth": {
      const justSignedIn = state.signingIn && message.login !== undefined;
      state.signingIn = false;
      state.login = message.login;
      state.error = message.error;
      return justSignedIn ? "signedIn" : "updated";
    }
    case "publish.submitted":
      state.submitting = false;
      return "submitted";
    case "publish.failed":
      state.running = false;
      state.submitting = false;
      state.error = message.error;
      return "updated";
    default:
      return "ignored";
  }
}

interface PublishDone {
  element: HTMLElement;
  /** Sets the pull request link; anything but an https URL leaves the link out. */
  setUrl(url: string): void;
  /** Moves focus to the heading so a screen reader announces the result. */
  focus(): void;
}

function createPublishDone(onStartOver: () => void): PublishDone {
  const heading = renderElement("h2", { class: "ls-tpl-detail-title", tabindex: -1, text: "Submitted for review" });
  const link = renderElement("a", { class: "ls-btn ls-btn-primary", html: renderIcon("external") }, renderElement("span", { text: "View pull request" }));
  const startOver = renderElement("button", { class: "ls-btn", type: "button", text: "Start over" });
  startOver.addEventListener("click", onStartOver);
  const element = renderElement("div", { class: "ls-tpl-publish-done" },
    heading,
    renderElement("p", { text: "A reviewer checks it on GitHub. It shows up in everyone’s gallery once merged; until then it is in My templates." }),
    renderElement("div", { class: "ls-tpl-publish-actions" }, link, startOver));

  return {
    element,
    setUrl(url) {
      const valid = url.startsWith("https://");
      link.hidden = !valid;
      if (valid) link.setAttribute("href", url);
      else link.removeAttribute("href");
    },
    focus: () => heading.focus(),
  };
}

export interface PublishScreenOptions {
  project: PublishProject;
  draft: PublishDraft;
  transport: GalleryTransport;
  onBack(): void;
}

export interface PublishScreen {
  element: HTMLElement;
  /** Applies a `publish.*` host message; other messages are ignored. */
  route(message: HostToGallery): void;
  /** Moves focus to the heading, the page's accessible name. */
  focus(): void;
  dispose(): void;
}

let nextHeadingId = 0;

export function createPublishScreen(options: PublishScreenOptions): PublishScreen {
  const { project, draft, transport } = options;
  const state = initialPublishState();
  const update = (patch: Partial<PublishState>): void => { Object.assign(state, patch); render(); };

  const send = (patch: Partial<PublishState>, message: GalleryToHost): void => { update(patch); transport.post(message); };

  const form = createPublishForm(() => update({ results: [], running: false, error: undefined }));
  const checkList = createCheckList(project.engineLabel, () =>
    send({ results: [], running: true, error: undefined }, { type: "publish.check", project, draft: form.read() }));
  const github = createGithubStep({
    onSignIn: () => send({ signingIn: true, error: undefined }, { type: "publish.signIn" }),
    onSubmit: () => send({ submitting: true, error: undefined }, { type: "publish.submit", project, draft: form.read() }),
  });
  const done = createPublishDone(() => {
    form.fill(draft);
    layout.showResult(false);
    update({ results: [], thumbnail: undefined, error: undefined });
    layout.heading.focus();
  });
  const layout = buildPublishLayout({
    project, headingId: `ls-tpl-publish-title-${nextHeadingId++}`, onBack: options.onBack,
    workflow: [form.element, checkList.element, github.element], done: done.element,
  });

  function render(): void {
    checkList.update(state.results, state.running, form.isValid());
    github.update({ visible: allChecksPassed(state), login: state.login, signingIn: state.signingIn, submitting: state.submitting, error: state.error });
    fillThumb(layout.preview, state.thumbnail, `First page of the ${project.title} template`);
  }

  function route(message: HostToGallery): void {
    const outcome = applyHostMessage(state, message);
    if (outcome === "ignored") return;
    if (message.type === "publish.submitted") {
      layout.showResult(true);
      done.setUrl(message.url);
    }
    render();
    if (outcome === "signedIn") github.focusSubmit();
    if (outcome === "submitted") done.focus();
  }

  form.fill(draft);
  render();
  return { element: layout.element, route, focus: () => layout.heading.focus(), dispose: () => layout.element.remove() };
}
