import { join } from "node:path";

import { texLiveProfile } from "../../../../../../src/writing/latex/toolchain/node/managed/index";

describe("texLiveProfile", () => {
  const lines = texLiveProfile("/tex").split("\n");

  it("installs scheme-full with every tree under texlive and user trees under user", () => {
    expect(lines).toEqual(expect.arrayContaining([
      "selected_scheme scheme-full",
      `TEXDIR ${join("/tex", "texlive")}`,
      `TEXMFLOCAL ${join("/tex", "texlive", "texmf-local")}`,
      `TEXMFSYSCONFIG ${join("/tex", "texlive", "texmf-config")}`,
      `TEXMFSYSVAR ${join("/tex", "texlive", "texmf-var")}`,
      `TEXMFHOME ${join("/tex", "user", "texmf")}`,
      `TEXMFVAR ${join("/tex", "user", "texmf-var")}`,
      `TEXMFCONFIG ${join("/tex", "user", "texmf-config")}`,
    ]));
  });

  it("leaves PATH alone and skips docs, sources and desktop integration", () => {
    for (const key of ["instopt_adjustpath", "tlpdbopt_install_docfiles", "tlpdbopt_install_srcfiles",
      "tlpdbopt_desktop_integration", "tlpdbopt_file_assocs", "tlpdbopt_w32_multi_user"]) {
      expect(lines).toContain(`${key} 0`);
    }
  });
});
