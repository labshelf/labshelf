// Builds the options page's LaTeX section around the helper setup card.
import { el, settingsSection } from "@labshelf/core/dom";
import type { ILatexHelper } from "@labshelf/core/helper";
import { mountHelperSetupCard, type HelperSetupDeps } from "./setupCard";

export function createHelperSetupSection(helper: ILatexHelper, deps: HelperSetupDeps): HTMLElement {
  const body = el("div");
  mountHelperSetupCard(body, helper, deps);
  return settingsSection({ title: "LaTeX", description: "Compile LaTeX projects on this computer through LabShelf Helper." }, body);
}
