/** Holds the engine flag and environment that keep an untrusted LaTeX source from running programs or writing outside its folders. */

export const NO_SHELL_ESCAPE = "-no-shell-escape";

// PLATFORM: `p` (paranoid) lets TeX write only below the working folder and `-output-directory`, and read only there or
// in the TeX tree; absolute and parent paths, and dotfiles, are refused.
export const TEX_FILE_ACCESS_ENV: Record<string, string> = { openout_any: "p", openin_any: "p" };
