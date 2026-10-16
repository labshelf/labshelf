// Types the builder each project format offers to commands that need a fresh build.
import type { ProjectFormat } from "@labshelf/core";

export type ProjectBuilders = Record<ProjectFormat, { request(projectFolder: string, trigger: "command"): Promise<{ status: string } | undefined> }>;
