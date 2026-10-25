// Writes the install-tl profile that puts a full TeX Live under the shared TeX folder.
import { join } from "node:path";

/** Profile text for `install-tl --profile`; every tree lives under `texRoot` so nothing touches the user's own TeX. */
export function createTexLiveProfile(texRoot: string): string {
  const system = join(texRoot, "texlive");
  const user = join(texRoot, "user");
  return [
    "selected_scheme scheme-full",
    `TEXDIR ${system}`,
    `TEXMFLOCAL ${join(system, "texmf-local")}`,
    `TEXMFSYSCONFIG ${join(system, "texmf-config")}`,
    `TEXMFSYSVAR ${join(system, "texmf-var")}`,
    `TEXMFHOME ${join(user, "texmf")}`,
    `TEXMFVAR ${join(user, "texmf-var")}`,
    `TEXMFCONFIG ${join(user, "texmf-config")}`,
    // LabShelf puts the bin dir on PATH for its own builds; the user's PATH and desktop stay untouched.
    "instopt_adjustpath 0",
    "tlpdbopt_install_docfiles 0",
    "tlpdbopt_install_srcfiles 0",
    "tlpdbopt_desktop_integration 0",
    "tlpdbopt_file_assocs 0",
    "tlpdbopt_w32_multi_user 0",
    "",
  ].join("\n");
}
