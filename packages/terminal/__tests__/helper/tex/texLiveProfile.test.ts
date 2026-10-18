import { join } from "node:path";

import { texLiveProfile } from "../../../src/helper/tex";

describe("texLiveProfile", () => {
  const lines = texLiveProfile("/data").split("\n");

  it("installs scheme-full with every tree under tex/texlive and user trees under tex/user", () => {
    expect(lines).toEqual(expect.arrayContaining([
      "selected_scheme scheme-full",
      `TEXDIR ${join("/data", "tex", "texlive")}`,
      `TEXMFLOCAL ${join("/data", "tex", "texlive", "texmf-local")}`,
      `TEXMFSYSCONFIG ${join("/data", "tex", "texlive", "texmf-config")}`,
      `TEXMFSYSVAR ${join("/data", "tex", "texlive", "texmf-var")}`,
      `TEXMFHOME ${join("/data", "tex", "user", "texmf")}`,
      `TEXMFVAR ${join("/data", "tex", "user", "texmf-var")}`,
      `TEXMFCONFIG ${join("/data", "tex", "user", "texmf-config")}`,
    ]));
  });

  it("leaves PATH alone and skips docs, sources and desktop integration", () => {
    for (const key of ["instopt_adjustpath", "tlpdbopt_install_docfiles", "tlpdbopt_install_srcfiles",
      "tlpdbopt_desktop_integration", "tlpdbopt_file_assocs", "tlpdbopt_w32_multi_user"]) {
      expect(lines).toContain(`${key} 0`);
    }
  });
});
