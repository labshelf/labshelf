// Changes a Space's own fields: name, purpose and linked writing projects.
import type { Space } from "../../model/index.js";
import { withOptionalField } from "./optionalField.js";

export function withSpaceRenamed(space: Space, name: string): Space {
  const trimmed = name.trim();
  if (trimmed === "") { throw new Error("A Space needs a name."); }
  return { ...space, name: trimmed };
}

/** A blank purpose clears it. */
export function withPurpose(space: Space, purpose: string | undefined): Space {
  const trimmed = purpose?.trim();
  return withOptionalField(space, "purpose", trimmed === "" ? undefined : trimmed);
}

export function withProject(space: Space, projectId: string): Space {
  return space.projects.includes(projectId) ? space : { ...space, projects: [...space.projects, projectId] };
}

export function withProjectRemoved(space: Space, projectId: string): Space {
  return { ...space, projects: space.projects.filter((id) => id !== projectId) };
}
