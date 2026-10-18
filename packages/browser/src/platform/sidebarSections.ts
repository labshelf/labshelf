// Reads and edits the setting that picks which sections the library page sidebar shows.

/** Which sidebar sections the library page shows; at least one is always on. */
export interface SidebarSections {
  library: boolean;
  projects: boolean;
}

export const DEFAULT_SIDEBAR_SECTIONS: SidebarSections = { library: true, projects: true };

/** Reads a stored value; storage is outside the type system, so anything unreadable shows both sections. */
export function readSidebarSections(raw: unknown): SidebarSections {
  const { library, projects } = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof SidebarSections, unknown>>;
  const next = {
    library: typeof library === "boolean" ? library : DEFAULT_SIDEBAR_SECTIONS.library,
    projects: typeof projects === "boolean" ? projects : DEFAULT_SIDEBAR_SECTIONS.projects,
  };
  return next.library || next.projects ? next : DEFAULT_SIDEBAR_SECTIONS;
}

/** Sets one section; turning off the last visible one leaves the choice as it was. */
export function withSidebarSection(current: SidebarSections, section: keyof SidebarSections, on: boolean): SidebarSections {
  const next = { ...current, [section]: on };
  return next.library || next.projects ? next : current;
}
