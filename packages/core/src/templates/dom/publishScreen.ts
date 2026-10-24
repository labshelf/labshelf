// Renders the Publish screen: form, checks, GitHub step and result on the left, the compiled preview on the right.
import type { GalleryToHost, GalleryTransport, HostToGallery, PublishDraft, PublishProject } from "../protocol/index.js";
import { fillThumb } from "./templateCard.js";
import { createCheckList } from "./checkList.js";
import { createGithubStep } from "./githubStep.js";
import { createPublishDone } from "./publishDone.js";
import { buildPublishLayout } from "./publishLayout.js";
import { createPublishForm } from "./publishForm.js";
import { allChecksPassed, applyHostMessage, initialPublishState, type PublishState } from "./publishState.js";

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
