// Writes the install-tl profile that puts a full TeX Live under the helper's data directory.
import { join } from "node:path";

/** Profile text for `install-tl --profile`; every tree lives under `<dataDir>/tex/` so nothing touches the user's own TeX. */
export function texLiveProfile(dataDir: string): string {
  const system = join(dataDir, "tex", "texlive");
  const user = join(dataDir, "tex", "user");
  return [
    "selected_scheme scheme-full",
    `TEXDIR ${system}`,
    `TEXMFLOCAL ${join(system, "texmf-local")}`,
    `TEXMFSYSCONFIG ${join(system, "texmf-config")}`,
    `TEXMFSYSVAR ${join(system, "texmf-var")}`,
    `TEXMFHOME ${join(user, "texmf")}`,
    `TEXMFVAR ${join(user, "texmf-var")}`,
    `TEXMFCONFIG ${join(user, "texmf-config")}`,
    // The helper puts the bin dir on PATH for its own builds; the user's PATH and desktop stay untouched.
    "instopt_adjustpath 0",
    "tlpdbopt_install_docfiles 0",
    "tlpdbopt_install_srcfiles 0",
    "tlpdbopt_desktop_integration 0",
    "tlpdbopt_file_assocs 0",
    "tlpdbopt_w32_multi_user 0",
    "",
  ].join("\n");
}
