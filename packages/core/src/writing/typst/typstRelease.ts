/** Pins the Typst compiler LabShelf ships and the default fonts it loads, so a document renders the same in every app. */

// INVARIANT: the Typst inside @myriaddreamin/typst-ts-web-compiler 0.7.0; the two change together.
export const TYPST_VERSION = "0.14.2";

export const TYPST_FONT_BASE_URL = `https://raw.githubusercontent.com/typst/typst-assets/v${TYPST_VERSION}/files/fonts/`;

export interface TypstFontFile {
  file: string;
  sha256: string;
}

/** Typst's default text fonts: the ones the CLI embeds, which the WASM compiler does not. */
export const TYPST_FONTS: readonly TypstFontFile[] = [
  { file: "DejaVuSansMono-Bold.ttf", sha256: "bce60f1b4421acd9ea51ba6623d7024ecbe6817a953e3654df62a5e6bdf8f769" },
  { file: "DejaVuSansMono-BoldOblique.ttf", sha256: "91713a71d550bba22c2a6b2bb2a9ad8f9a159e12e4e9f0a5b2677998ba21213e" },
  { file: "DejaVuSansMono-Oblique.ttf", sha256: "742097840c541870e8d6dc5c9b37bb1ceeea6c0dedd1d475faf903ef9df734b0" },
  { file: "DejaVuSansMono.ttf", sha256: "b4a6c3e4faab8773f4ff761d56451646409f29abedd68f05d38c2df667d3c582" },
  { file: "LibertinusSerif-Bold.otf", sha256: "0264914210ed51b3231ebc92ce529e9f2e166ba9eebf0cd4a579558690a27b64" },
  { file: "LibertinusSerif-BoldItalic.otf", sha256: "47a665259f09f554f5d133d7718cdad43ff462c6a6b2328f38023465e62d57ce" },
  { file: "LibertinusSerif-Italic.otf", sha256: "9a393d63d6e05f620d3dc0190dfd35a8ede58c0808cf0fc9de7fcb9c723e4c24" },
  { file: "LibertinusSerif-Regular.otf", sha256: "fcf06307a77367394fcb0ccb241e59eea70dba3d732be309647611224679c733" },
  { file: "LibertinusSerif-Semibold.otf", sha256: "a4b3f28e85881db34695c1f005e4c79233a6caf3a2bd286c9b418c025fb99308" },
  { file: "LibertinusSerif-SemiboldItalic.otf", sha256: "397f0d7aba35ae6a988948ae046c14c6b1e0d270fcc6e292b8bc29fd625c6101" },
  { file: "NewCM10-Bold.otf", sha256: "d86a61b9956e038b51d172f0030660caf404e1adf5a3d93266ef1790c37c1a99" },
  { file: "NewCM10-BoldItalic.otf", sha256: "ad0b8aa45ef116f5016d51aeb90aca2a7fa3640a14d3ef9c15b9e74d1a51a041" },
  { file: "NewCM10-Italic.otf", sha256: "ecc561ea03eb21f9623a7c99a6a17e371cf8eddc53039bc347380f40ce6c4d77" },
  { file: "NewCM10-Regular.otf", sha256: "79feac95755b8df2f0be45f55bdaf6c2b3b08f58b1f67518401cf235423e0b84" },
  { file: "NewCMMath-Bold.otf", sha256: "9cf39c5665ca73d4d5921628798126daa7eec4db3b83e0ca617c224d0c0ddd56" },
  { file: "NewCMMath-Book.otf", sha256: "765b14d6f8a8d3e9b319f168cc1b10dd89df38d34108e75b44013904bb173218" },
  { file: "NewCMMath-Regular.otf", sha256: "ad746f5307fed53d8e5d7d201f5054abe73f1f47c51040767d898e3481c6e648" },
];
