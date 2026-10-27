// Renders the Publish screen: form, checks, GitHub step and result on the left, the compiled preview on the right.
import { renderIcon, type IconName } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";
import type {
  GalleryToHost,
  GalleryTransport,
  HostToGallery,
  PublishCheckResult,
  PublishDraft,
  PublishProject,
} from "../host/index.js";
import { CATEGORY_LABELS, PUBLISH_CHECK_IDS, publishCheckLabel, type PublishCheckId } from "../templateLabels.js";
import { updateThumbnailBox } from "./templateCards.js";

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
    updateThumbnailBox(layout.preview, state.thumbnail, `First page of the ${project.title} template`);
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

export interface PublishForm {
  element: HTMLElement;
  /** The current values of the four controls. */
  read(): PublishDraft;
  /** Puts the draft's values back into the controls. */
  fill(draft: PublishDraft): void;
  /** Reports whether the required fields have a value. */
  isValid(): boolean;
}

const LICENSES = ["MIT", "MIT-0", "CC-BY-4.0", "LPPL-1.3c", "Apache-2.0"];
// "Other" is a catalog fallback, not something an author picks.
const CATEGORIES = Object.entries(CATEGORY_LABELS).filter(([id]) => id !== "other");

let nextFieldId = 0;

function labelled(label: string, control: HTMLElement): HTMLElement {
  control.id = `ls-tpl-publish-field-${nextFieldId++}`;
  return renderElement("div", { class: "ls-tpl-field" }, renderElement("label", { for: control.id, text: label }), control);
}

function select(options: ReadonlyArray<readonly [string, string]>): HTMLSelectElement {
  return renderElement("select", { class: "ls-input" }, ...options.map(([value, text]) => renderElement("option", { value, text })));
}

/** @param onEdit called after any control changed, so the caller can drop results that no longer match. */
export function createPublishForm(onEdit: () => void): PublishForm {
  const name = renderElement("input", { class: "ls-input", type: "text", required: true, "aria-required": "true" });
  const category = select(CATEGORIES);
  const license = select(LICENSES.map((id) => [id, id] as const));
  const description = renderElement("textarea", { class: "ls-input", rows: 4, required: true, "aria-required": "true" });
  const element = renderElement("div", { class: "ls-tpl-form" },
    labelled("Name", name), labelled("Category", category), labelled("License", license), labelled("Description", description));
  element.addEventListener("input", onEdit);

  return {
    element,
    read: () => ({ name: name.value, category: category.value, license: license.value, description: description.value }),
    fill(draft) {
      // A license the host prefilled that the list lacks stays selectable instead of silently turning into MIT.
      if (!LICENSES.includes(draft.license) && ![...license.options].some((o) => o.value === draft.license)) {
        license.append(renderElement("option", { value: draft.license, text: draft.license }));
      }
      name.value = draft.name;
      category.value = draft.category;
      license.value = draft.license;
      description.value = draft.description;
    },
    isValid: () => name.value.trim() !== "",
  };
}

type CheckRowState = "idle" | "running" | "passed" | "failed";

export interface CheckList {
  element: HTMLElement;
  /** Patches every row and the summary; `canRun` enables the run button when the form is valid. */
  update(results: readonly PublishCheckResult[], running: boolean, canRun: boolean): void;
}

// The icon set has no empty circle; a dash reads as "not run yet".
const ROW_ICONS: Record<CheckRowState, IconName> = { idle: "minus", running: "loader", passed: "check", failed: "x" };

interface Row { id: PublishCheckId; item: HTMLLIElement; icon: HTMLElement; message: HTMLElement }

function rowState(result: PublishCheckResult | undefined, running: boolean): CheckRowState {
  if (result?.ok === true) return "passed";
  if (result?.ok === false) return "failed";
  return running ? "running" : "idle";
}

/** "All checks passed", "2 checks failed", "3 of 6 checks passed" or "" before any run. */
function checkSummary(states: readonly CheckRowState[], running: boolean): string {
  const passed = states.filter((s) => s === "passed").length;
  const failed = states.filter((s) => s === "failed").length;
  if (failed > 0) return `${failed} ${failed === 1 ? "check" : "checks"} failed`;
  if (running) return "Running checks…";
  if (passed === states.length) return "All checks passed";
  return passed > 0 ? `${passed} of ${states.length} checks passed` : "";
}

function buildRow(id: PublishCheckId, engineLabel: string): Row {
  const iconBox = renderElement("span", { class: "ls-tpl-check-icon" });
  const message = renderElement("div", { class: "ls-tpl-check-message" });
  const item = renderElement("li", { class: "ls-tpl-check", "data-state": "idle" },
    iconBox, renderElement("div", { class: "ls-tpl-check-text" }, renderElement("div", { text: publishCheckLabel(id, engineLabel) }), message));
  return { id, item, icon: iconBox, message };
}

export function createCheckList(engineLabel: string, onRun: () => void): CheckList {
  const rows = PUBLISH_CHECK_IDS.map((id) => buildRow(id, engineLabel));
  const run = renderElement("button", { class: "ls-btn", type: "button", text: "Run checks" });
  const summary = renderElement("p", { class: "ls-tpl-check-summary", "aria-live": "polite" });
  run.addEventListener("click", onRun);
  const element = renderElement("div", { class: "ls-tpl-checks" },
    renderElement("div", { class: "ls-tpl-publish-section" }, renderElement("h2", { text: "Checks" }), run),
    renderElement("ul", { class: "ls-tpl-check-list", role: "list" }, ...rows.map((row) => row.item)),
    summary);

  const update = (results: readonly PublishCheckResult[], running: boolean, canRun: boolean): void => {
    const states = rows.map((row) => {
      const result = results.find((r) => r.id === row.id);
      const state = rowState(result, running);
      row.item.dataset["state"] = state;
      if (state === "running") row.item.setAttribute("aria-busy", "true");
      else row.item.removeAttribute("aria-busy");
      row.icon.innerHTML = renderIcon(ROW_ICONS[state]);
      row.icon.classList.toggle("ls-tpl-spin", state === "running");
      row.message.textContent = state === "failed" ? (result?.message ?? "") : "";
      return state;
    });
    summary.textContent = checkSummary(states, running);
    run.disabled = running || !canRun;
  };
  update([], false, true);
  return { element, update };
}

interface GithubStepState {
  /** Shown only once every check passed. */
  visible: boolean;
  login: string | undefined;
  signingIn: boolean;
  submitting: boolean;
  error: string | undefined;
}

export interface GithubStep {
  element: HTMLElement;
  update(state: GithubStepState): void;
  /** Moves focus to the Submit button, where the sign-in button was. */
  focusSubmit(): void;
}

export interface GithubStepHandlers {
  onSignIn(): void;
  onSubmit(): void;
}

function fillButton(button: HTMLButtonElement, busy: boolean, label: string, busyLabel: string): void {
  button.disabled = busy;
  if (busy) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
  button.replaceChildren(
    ...(busy ? [renderElement("span", { class: "ls-tpl-spin", html: renderIcon("loader") })] : []),
    renderElement("span", { text: busy ? busyLabel : label }));
}

export function createGithubStep(handlers: GithubStepHandlers): GithubStep {
  const intro = renderElement("p", { class: "ls-tpl-github-intro", text: "Sign in once with GitHub. LabShelf opens the pull request for you." });
  const signedAs = renderElement("p", { class: "ls-tpl-github-intro" });
  const signIn = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button" });
  const submit = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button" });
  const alert = renderElement("p", { class: "ls-tpl-engine ls-tpl-publish-alert", role: "alert" });
  const element = renderElement("div", { class: "ls-tpl-github" }, intro, signedAs, signIn, submit, alert);
  signIn.addEventListener("click", handlers.onSignIn);
  submit.addEventListener("click", handlers.onSubmit);

  const update = (state: GithubStepState): void => {
    const signedIn = state.login !== undefined;
    element.hidden = !state.visible;
    intro.hidden = signedIn;
    signIn.hidden = signedIn;
    signedAs.hidden = !signedIn;
    submit.hidden = !signedIn;
    signedAs.textContent = signedIn ? `Signed in as ${state.login}` : "";
    fillButton(signIn, state.signingIn, "Sign in with GitHub", "Signing in…");
    fillButton(submit, state.submitting, "Submit for review", "Submitting…");
    alert.hidden = state.error === undefined;
    alert.replaceChildren(
      ...(state.error === undefined ? [] : [renderElement("span", { class: "ls-tpl-engine-icon", html: renderIcon("warning") }), renderElement("span", { text: state.error })]));
  };
  return { element, update, focusSubmit: () => submit.focus() };
}
