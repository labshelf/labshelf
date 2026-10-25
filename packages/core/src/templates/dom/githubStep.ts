// Renders the GitHub step of the Publish screen: sign in, then submit for review, with the failure of either shown inline.
import { renderIcon } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";

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
