// The panel above a LaTeX or Typst source when its language cannot be checked: install the missing dictionary, retry a checker
// that could not start, or say spelling is not available.
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { showPanel, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import { renderElement } from "../../../ui/dom/index.js";
import type { DocumentLanguage } from "../../proofing/index.js";
import type { ProofingStatusName } from "./proofing.js";

/** What the notice reads from proofing and how it installs, so it needs no runtime import of the proofing module. */
export interface ProofingNoticeSource {
  current(state: EditorState): { language: DocumentLanguage; status: ProofingStatusName; error?: string | undefined } | undefined;
  /** Installs the dictionary of `tag` and loads its checker; resolves to the effects that start checking in the state of that moment. */
  install(state: EditorState, tag: string): Promise<(state: EditorState) => readonly StateEffect<unknown>[]>;
  /** Loads the checker of `tag` again after it failed to start; resolves like `install`. */
  retry(state: EditorState, tag: string): Promise<(state: EditorState) => readonly StateEffect<unknown>[]>;
}

interface NoticeState {
  language: DocumentLanguage;
  status: ProofingStatusName;
  /** Why the checker could not start, when `status` is "failed". */
  failure: string | null;
  /** The language the notice is about; a new one forgets a dismissal and a pending install. */
  key: string;
  dismissed: boolean;
  installing: boolean;
  error: string | null;
}

const installStarted = StateEffect.define<string>();
const installEnded = StateEffect.define<{ key: string; error: string | null }>();
const dismissNotice = StateEffect.define<string>();

const keyOf = (language: DocumentLanguage): string => language.tag ?? `name:${language.name}`;

function fresh(language: DocumentLanguage, status: ProofingStatusName, failure: string | null): NoticeState {
  return { language, status, failure, key: keyOf(language), dismissed: false, installing: false, error: null };
}

function shown(notice: NoticeState): boolean {
  if (notice.dismissed) return false;
  return notice.installing || notice.error !== null || notice.status === "missing" || notice.status === "unsupported" || notice.status === "failed";
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().replace(/\.$/, "");
}

interface NoticeButton { label: string; primary?: boolean; run(): void }

/** The notice's text and buttons for its state. */
function content(notice: NoticeState, actions: { install(): void; dismiss(): void }): { text: string; buttons: NoticeButton[] } {
  const { name } = notice.language;
  if (notice.status === "unsupported") return { text: `Spelling is not available for ${name}.`, buttons: [{ label: "Dismiss", run: actions.dismiss }] };
  if (notice.status === "failed" || (notice.installing && notice.failure !== null)) {
    const failure = notice.failure ?? "unknown error";
    return { text: notice.installing ? `Starting spelling for ${name}…` : `Spelling could not start: ${failure}.`, buttons: [{ label: "Retry", primary: true, run: actions.install }, { label: "Dismiss", run: actions.dismiss }] };
  }
  if (notice.installing) {
    return { text: `Installing the ${name} dictionary…`, buttons: [{ label: "Install", primary: true, run: actions.install }, { label: "Not now", run: actions.dismiss }] };
  }
  if (notice.error !== null) {
    return { text: `Could not install the ${name} dictionary: ${notice.error}.`, buttons: [{ label: "Retry", primary: true, run: actions.install }, { label: "Not now", run: actions.dismiss }] };
  }
  return { text: `No ${name} dictionary installed.`, buttons: [{ label: "Install", primary: true, run: actions.install }, { label: "Not now", run: actions.dismiss }] };
}

class NoticePanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private readonly text: HTMLElement;
  private readonly actions: HTMLElement;
  private destroyed = false;
  /** Set when Install or Retry is pressed, so focus returns to the panel's buttons once they are enabled again. */
  private keepFocus = false;

  constructor(private readonly view: EditorView, private readonly field: StateField<NoticeState>, private readonly source: ProofingNoticeSource) {
    this.dom = renderElement("div", { class: "ls-proofing-notice" });
    this.text = renderElement("span", { class: "ls-proofing-notice-text", role: "status" });
    this.actions = renderElement("div", { class: "ls-proofing-notice-actions" });
    this.dom.append(this.text, this.actions);
    this.render(view.state.field(field));
  }

  update(update: ViewUpdate): void {
    const notice = update.state.field(this.field);
    if (notice !== update.startState.field(this.field)) this.render(notice);
  }

  destroy(): void {
    this.destroyed = true;
  }

  private render(notice: NoticeState): void {
    const { text, buttons } = content(notice, { install: () => this.install(), dismiss: () => this.dismiss() });
    this.text.textContent = text;
    this.dom.setAttribute("aria-busy", String(notice.installing));
    this.actions.replaceChildren(...buttons.map((item) => {
      const button = renderElement("button", { type: "button", class: item.primary ? "ls-btn ls-btn-primary" : "ls-btn", text: item.label }) as HTMLButtonElement;
      button.disabled = notice.installing;
      button.addEventListener("click", () => item.run());
      return button;
    }));
    if (this.keepFocus && !notice.installing) {
      this.keepFocus = false;
      this.actions.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }

  private install(): void {
    const notice = this.view.state.field(this.field);
    const tag = notice.language.tag;
    if (tag === null || notice.installing) return;
    const { key } = notice;
    this.keepFocus = true;
    this.view.dispatch({ effects: installStarted.of(key) });
    const start = notice.status === "failed" ? this.source.retry(this.view.state, tag) : this.source.install(this.view.state, tag);
    start.then(
      (effectsFor) => {
        if (this.destroyed) return;
        this.view.dispatch({ effects: [installEnded.of({ key, error: null }), ...effectsFor(this.view.state)] });
        if (!shown(this.view.state.field(this.field))) this.view.focus();
      },
      (error: unknown) => {
        if (this.destroyed) return;
        this.view.dispatch({ effects: installEnded.of({ key, error: messageOf(error) }) });
      },
    );
  }

  private dismiss(): void {
    const notice = this.view.state.field(this.field);
    this.view.dispatch({ effects: dismissNotice.of(notice.key) });
    this.view.focus();
  }
}

/** The install notice of an editor with proofing; Not now and Dismiss hide it until the language changes. */
export function proofingNotice(source: ProofingNoticeSource): Extension {
  const field: StateField<NoticeState> = StateField.define<NoticeState>({
    create(state) {
      const current = source.current(state);
      return fresh(current?.language ?? { tag: "en-US", name: "English", declared: false }, current?.status ?? "loading", current?.error ?? null);
    },
    update(value, tr) {
      const current = source.current(tr.state);
      let next = value;
      if (current) {
        const failure = current.error ?? null;
        if (keyOf(current.language) !== value.key) next = fresh(current.language, current.status, failure);
        else if (current.language !== value.language || current.status !== value.status || failure !== value.failure) next = { ...next, language: current.language, status: current.status, failure };
      }
      for (const effect of tr.effects) {
        if (effect.is(installStarted) && effect.value === next.key) next = { ...next, installing: true, error: null };
        else if (effect.is(installEnded) && effect.value.key === next.key) next = { ...next, installing: false, error: effect.value.error };
        else if (effect.is(dismissNotice) && effect.value === next.key) next = { ...next, dismissed: true };
      }
      return next;
    },
  });
  const create = (view: EditorView): Panel => new NoticePanel(view, field, source);
  return [field, showPanel.from(field, (notice) => (shown(notice) ? create : null))];
}
