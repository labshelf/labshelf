// Mounts a positioned research conversation scoped to a Space or project.
import { el, positioned } from "../../../ui/dom/index.js";

export interface ResearchChat {
  setContext(name: string | null): void;
  dispose(): void;
}

export function mountResearchChat(root: HTMLElement, options: { context: string | null }): ResearchChat {
  const name = el("strong", { class: "chat-context-name" });
  const context = el("div", { class: "chat-context" }, el("span", { text: "Context" }), name,
    el("span", { text: "Add papers or notes to ground your question." }), button("Add context", "ls-btn ls-btn-ghost"));
  const welcome = el("div", { class: "chat-welcome" }, el("h2", { text: "Think alongside your research" }),
    el("p", { text: "Ask about a passage, compare methods or work through a derivation." }),
    ...["Compare the methods in this Space", "Help me work through a derivation", "What should I read next?"]
      .map(text => button(text, "chat-suggestion")));
  const panel = el("section", { class: "chat-panel", "aria-label": "Research chat" },
    el("header", { class: "chat-head" }, el("strong", { text: "Research chat" })), context,
    el("div", { class: "chat-messages", "aria-live": "polite" }, welcome), composer(),
    el("p", { class: "chat-privacy", text: "No model connected" }));
  const setContext = (value: string | null): void => {
    name.textContent = value ?? "Library";
    name.title = value ?? "Library";
  };
  setContext(options.context);
  root.replaceChildren(panel);
  return { setContext, dispose: () => root.replaceChildren() };
}

function button(text: string, className: string): HTMLButtonElement {
  const control = el("button", { class: className, type: "button", text });
  positioned(control, "Needs a connected model");
  return control;
}

function composer(): HTMLElement {
  const input = el("textarea", { rows: 3, placeholder: "Ask a question…", readonly: true });
  positioned(input, "Needs a connected model");
  return el("div", { class: "chat-compose" },
    el("label", {}, "Ask about your research", input),
    el("div", {}, el("span", { text: "Your conversation will be private." }), button("Send message", "ls-btn ls-button-soft")));
}
