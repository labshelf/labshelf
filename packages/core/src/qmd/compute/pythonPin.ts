// Pins the managed Python: the python-build-standalone release per platform and the SymPy and mpmath wheels, each with its SHA-256.

type PythonPlatform = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "win32-x64";

interface PythonWheel {
  version: string;
  url: string;
  sha256: string;
}

export interface PythonPin {
  /** The python-build-standalone release tag. */
  release: string;
  /** The CPython version inside the archives. */
  version: string;
  archives: Record<PythonPlatform, { url: string; sha256: string }>;
  wheels: { sympy: PythonWheel; mpmath: PythonWheel };
}

const RELEASE = "20261026";
const VERSION = "3.12.16";
const archive = (target: string, sha256: string): { url: string; sha256: string } => ({
  url: `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}/cpython-${VERSION}%2B${RELEASE}-${target}-install_only.tar.gz`,
  sha256,
});

// INVARIANT: sympy 1.14 requires mpmath<1.4, so mpmath stays on 1.3.0 although PyPI has newer releases.
export const PYTHON_PIN: PythonPin = {
  release: RELEASE,
  version: VERSION,
  archives: {
    "darwin-arm64": archive("aarch64-apple-darwin", "fbf4afef53c2a6b72bb741bc06d5671a9dfaf87bd84e5aa73ac9b3d0d589f14e"),
    "darwin-x64": archive("x86_64-apple-darwin", "a962e47df522889eaa7ff0d6a56203f1079f68aabb65ffdbe8455f362bc769f3"),
    "linux-x64": archive("x86_64-unknown-linux-gnu", "6a79e922e50006b601f29e688407659da1c2b86ebcd4e9c7254cf234be8b89de"),
    "linux-arm64": archive("aarch64-unknown-linux-gnu", "a945427411dc6851a1393533b74a4a1ac434321ae397f2ec69897a9b4fde032b"),
    "win32-x64": archive("x86_64-pc-windows-msvc", "590dfcbe3a34c07301e6332e13e2188b98655cd072b08afa45a7998dc4c22bc5"),
  },
  wheels: {
    sympy: {
      version: "1.14.0",
      url: "https://files.pythonhosted.org/packages/a2/09/77d55d46fd61b4a135c444fc97158ef34a095e5681d0a6c10b75bf356191/sympy-1.14.0-py3-none-any.whl",
      sha256: "e091cc3e99d2141a0ba2847328f5479b05d94a6635cb96148ccb3f34671bd8f5",
    },
    mpmath: {
      version: "1.3.0",
      url: "https://files.pythonhosted.org/packages/43/e3/7d92a15f894aa0c9c4b49b8ee9ac9850d6e63b03c9c32c0367a13ae62209/mpmath-1.3.0-py3-none-any.whl",
      sha256: "a0b2b9fe80bbcd81a6647ff13108738cfb482d481d826cc0e02f5b35e5c88d2c",
    },
  },
};
