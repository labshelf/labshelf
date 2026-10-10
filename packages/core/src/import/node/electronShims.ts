/**
 * Makes pdf.js usable inside an Electron utility process such as the VS Code extension host. pdf.js decides at import
 * time whether it runs under Node and an Electron utility process fails that test, so it assumes a browser and reads
 * navigator and DOMMatrix, which do not exist there.
 */
const PLATFORM_BY_OS: Record<string, string> = {
  linux: "Linux x86_64",
  darwin: "MacIntel",
  win32: "Win32",
};

/** Installs the globals pdf.js reads while its module loads: navigator and a DOMMatrix stub. */
export function installElectronGlobals(): void {
  const globals = globalThis as Record<string, unknown>;
  ensureNavigator(globals);
  if (typeof globals["DOMMatrix"] === "undefined") {
    globals["DOMMatrix"] = createDomMatrixStub();
  }
}

/** Caches FeatureTest.platform so pdf.js never reads an undefined navigator after it has loaded. */
export function patchFeatureTestPlatform(pdfjs: Record<string, unknown>): void {
  const featureTest = pdfjs["FeatureTest"] as Record<string, unknown> | undefined;
  const shadow = pdfjs["shadow"] as ((obj: object, prop: string, value: unknown) => void) | undefined;
  if (!featureTest || !shadow) {
    return;
  }
  try {
    void featureTest["platform"];
  } catch {
    shadow(featureTest, "platform", {
      isAndroid: false,
      isLinux: true,
      isMac: false,
      isWindows: false,
      isFirefox: false,
    });
  }
}

function ensureNavigator(globals: Record<string, unknown>): void {
  const platform = PLATFORM_BY_OS[process.platform] ?? "Linux x86_64";
  const userAgent = `Node.js ${process.version}`;
  const descriptor = Object.getOwnPropertyDescriptor(globals, "navigator");
  // Node's own navigator is a getter whose first read prints a migration warning; it already has both fields.
  if (descriptor?.get) return;
  const current = descriptor?.value as { platform?: unknown; userAgent?: unknown } | undefined;
  try {
    if (current && typeof current === "object") {
      if (typeof current.platform !== "string") {
        Object.defineProperty(current, "platform", { value: platform, configurable: true });
      }
      if (typeof current.userAgent !== "string") {
        Object.defineProperty(current, "userAgent", { value: userAgent, configurable: true });
      }
    } else {
      Object.defineProperty(globals, "navigator", { value: { platform, userAgent, language: "en-US" }, configurable: true });
    }
  } catch {
    // A read-only navigator already carries its fields; patchFeatureTestPlatform covers the rest.
  }
}

// pdf.js needs the constructor and the 2D fields at module load time, nothing more.
function createDomMatrixStub(): new (init?: number[] | string) => unknown {
  class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true; isIdentity = true;

    constructor(init?: number[] | string) {
      if (Array.isArray(init) && init.length >= 6) {
        this.a = init[0] ?? 1; this.b = init[1] ?? 0;
        this.c = init[2] ?? 0; this.d = init[3] ?? 1;
        this.e = init[4] ?? 0; this.f = init[5] ?? 0;
        this.m11 = this.a; this.m12 = this.b;
        this.m21 = this.c; this.m22 = this.d;
        this.m41 = this.e; this.m42 = this.f;
        this.isIdentity = this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
      }
    }

    multiply(_other: DOMMatrix): DOMMatrix { return new DOMMatrix(); }
    preMultiplySelf(_other: DOMMatrix): this { return this; }
    multiplySelf(_other: DOMMatrix): this { return this; }
    invertSelf(): this { return this; }
    translate(_tx = 0, _ty = 0): DOMMatrix { return new DOMMatrix(); }
    scale(_sx = 1, _sy = 1): DOMMatrix { return new DOMMatrix(); }
    transformPoint(point?: { x?: number; y?: number }): { x: number; y: number; z: number; w: number } {
      return { x: point?.x ?? 0, y: point?.y ?? 0, z: 0, w: 1 };
    }
  }
  return DOMMatrix;
}
