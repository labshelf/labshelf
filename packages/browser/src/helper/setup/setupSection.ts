// Builds the options page's LaTeX section around the helper setup card.
import { renderElement, renderSettingsSection } from "@labshelf/core/dom";
import type { ILatexHelper } from "@labshelf/core/helper";
import { mountHelperSetupCard, type HelperSetupDeps } from "./setupCard";

export function createHelperSetupSection(helper: ILatexHelper, deps: HelperSetupDeps): HTMLElement {
  const body = renderElement("div");
  mountHelperSetupCard(body, helper, deps);
  return renderSettingsSection({ title: "LaTeX", description: "Compile LaTeX projects on this computer through LabShelf Helper." }, body);
}
