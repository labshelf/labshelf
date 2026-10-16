// Renders the GitHub step of the Publish screen: sign in, then submit for review, with the failure of either shown inline.
import { icon } from "../../../../ui/index.js";
import { el } from "../../../../ui/dom/index.js";

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
    ...(busy ? [el("span", { class: "ls-tpl-spin", html: icon("loader") })] : []),
    el("span", { text: busy ? busyLabel : label }));
}

export function createGithubStep(handlers: GithubStepHandlers): GithubStep {
  const intro = el("p", { class: "ls-tpl-github-intro", text: "Sign in once with GitHub. LabShelf opens the pull request for you." });
  const signedAs = el("p", { class: "ls-tpl-github-intro" });
  const signIn = el("button", { class: "ls-btn ls-btn-primary", type: "button" });
  const submit = el("button", { class: "ls-btn ls-btn-primary", type: "button" });
  const alert = el("p", { class: "ls-tpl-engine ls-tpl-publish-alert", role: "alert" });
  const element = el("div", { class: "ls-tpl-github" }, intro, signedAs, signIn, submit, alert);
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
      ...(state.error === undefined ? [] : [el("span", { class: "ls-tpl-engine-icon", html: icon("warning") }), el("span", { text: state.error })]));
  };
  return { element, update, focusSubmit: () => submit.focus() };
}
