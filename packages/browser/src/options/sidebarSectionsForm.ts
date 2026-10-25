// Builds the Sidebar section: which of Library and Projects the library page sidebar shows; the last one shown cannot be turned off.
import { renderCheckboxField, renderSettingRow, renderSettingsSection } from "@labshelf/core/dom";
import { withSidebarSection, type SidebarSections } from "../platform";

export interface SidebarSectionsForm {
  section: HTMLElement;
  fill(sections: SidebarSections): void;
}

/** `onChange` stores the sections whenever the user changes them. */
export function createSidebarSectionsForm(onChange: (sections: SidebarSections) => void): SidebarSectionsForm {
  const fields = {
    library: renderCheckboxField({ id: "sidebar-library", label: "Library" }),
    projects: renderCheckboxField({ id: "sidebar-projects", label: "Projects" }),
  };
  let current: SidebarSections = { library: true, projects: true };
  const fill = (sections: SidebarSections): void => {
    current = sections;
    fields.library.control.checked = sections.library;
    fields.projects.control.checked = sections.projects;
  };
  for (const key of ["library", "projects"] as const) {
    fields[key].control.addEventListener("change", () => {
      const next = withSidebarSection(current, key, fields[key].control.checked);
      const changed = next !== current;
      // A refused change puts the box back.
      fill(next);
      if (changed) onChange(next);
    });
  }
  return {
    section: renderSettingsSection(
      { title: "Sidebar", description: "The sections the library page sidebar shows. A hidden section loads nothing. One section always stays on; reload the library page to apply a change." },
      renderSettingRow({}, fields.library.element),
      renderSettingRow({}, fields.projects.element),
    ),
    fill,
  };
}
