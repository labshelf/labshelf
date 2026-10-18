// Names the TeX distributions LabShelf can install into the shared managed folder.
export const TEX_INSTALL_KINDS = ["tinytex", "texlive"] as const;
export type TexInstallKind = (typeof TEX_INSTALL_KINDS)[number];
