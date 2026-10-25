// Tests verifying detached OpenPGP signatures against a pinned key block, including a real TeX Live signature.
import { pinnedKeyFingerprints, verifyDetachedSignature } from "../../../../src/latex/toolchain/node/verifySignature";
import { TEX_LIVE_SIGNING_KEY } from "../../../../src/latex/toolchain/node/managedTex/texLiveKeyring";
import { armoredSignature, createTestSigningKey } from "./fakeOpenPgp";

// The install-tl-unx.tar.gz.sha512 and .sha512.asc that CTAN served on 2026-10-18.
const REAL_CHECKSUM = Buffer.from("9d0d053ba93af7a85693f6e8dd174d9c7328f45b88aa5eab5136cb38dba95b670bc7b4989b6622ff4e0a1d0f4e4dfa5fc6689ce78843be7bb1edbf1ea98fa2d2  install-tl-unx.tar.gz\n");
const REAL_SIGNATURE = `-----BEGIN PGP SIGNATURE-----

iQEzBAEBCgAdFiEE2PL4YFeoV+QqiBBqTOGHfhlDjHAFAmrSuIgACgkQTOGHfhlD
jHDpVQf+IVrQlYj7MqNukN0POKlw1Y0iz2FRpixadOvm+5b70wyBJyIFEuC/kgkx
zOxeoiba4hWsAcSsCh5waaHfJfK7JqI0br3mY1eHCFdEU/uCGwMlUzrif6QGbBlS
Z3VV/vgaeiEnBjnzwtM2Io1XRf+FRUNr7jBtKqIZhwqhCdQ5Hen5GHz6XM88lZDC
umpqDGIQtRRQxsSM/JmB66gH0DgEYBWtuheDiMYRuup1QS8JiqAmdMCIvOfuxfK7
GKY1OIT4GN7HpWKllZr1w8C1pQMREI5rQsca+oXdpUl0j++len7IzRCCppsVTqOe
i2XdeF8NR78VDfdzYeeB9OCfGlDFbQ==
=36oc
-----END PGP SIGNATURE-----
`;

describe("the pinned TeX Live key", () => {
  it("is the TeX Live Distribution key with its signing subkey", () => {
    expect(pinnedKeyFingerprints(TEX_LIVE_SIGNING_KEY)).toEqual(expect.arrayContaining([
      "C78B82D8C79512F79CC0D7C80D5E5D9106BAB6BC",
      "D8F2F86057A857E42A88106A4CE1877E19438C70",
    ]));
  });

  it("verifies a real CTAN checksum signature and names the signing subkey", () => {
    expect(verifyDetachedSignature(REAL_CHECKSUM, REAL_SIGNATURE, TEX_LIVE_SIGNING_KEY))
      .toBe("D8F2F86057A857E42A88106A4CE1877E19438C70");
  });

  it("rejects the real signature over a checksum with one changed digit", () => {
    const tampered = Buffer.from(REAL_CHECKSUM.toString().replace(/^9/, "8"));
    expect(verifyDetachedSignature(tampered, REAL_SIGNATURE, TEX_LIVE_SIGNING_KEY)).toBeUndefined();
  });
});

describe("verifyDetachedSignature", () => {
  const signer = createTestSigningKey();
  const data = Buffer.from("line one\nline two\n");

  it("accepts binary and canonical text signatures by a pinned key", () => {
    expect(verifyDetachedSignature(data, armoredSignature(data, signer.privateKey, 0x00), signer.armoredPublicKey)).toMatch(/^[0-9A-F]{40}$/);
    expect(verifyDetachedSignature(data, armoredSignature(data, signer.privateKey, 0x01), signer.armoredPublicKey)).toMatch(/^[0-9A-F]{40}$/);
  });

  it("treats CRLF and LF alike only for text signatures", () => {
    const crlf = Buffer.from("line one\r\nline two\r\n");
    expect(verifyDetachedSignature(crlf, armoredSignature(data, signer.privateKey, 0x01), signer.armoredPublicKey)).toBeDefined();
    expect(verifyDetachedSignature(crlf, armoredSignature(data, signer.privateKey, 0x00), signer.armoredPublicKey)).toBeUndefined();
  });

  it("rejects a signature by a key that is not pinned", () => {
    const other = createTestSigningKey();
    expect(verifyDetachedSignature(data, armoredSignature(data, other.privateKey), signer.armoredPublicKey)).toBeUndefined();
    expect(verifyDetachedSignature(data, armoredSignature(data, other.privateKey), TEX_LIVE_SIGNING_KEY)).toBeUndefined();
  });

  it("throws on text that is not an armored signature", () => {
    expect(() => verifyDetachedSignature(data, "not a signature", signer.armoredPublicKey)).toThrow(/PGP SIGNATURE/);
  });

  it("throws on a truncated signature packet", () => {
    const armored = armoredSignature(data, signer.privateKey);
    const lines = armored.split("\n");
    const cut = lines.map((line, index) => (index === 3 ? line.slice(0, 8) : line)).filter((_, index) => index <= 3 || index >= lines.length - 3);
    expect(() => verifyDetachedSignature(data, cut.join("\n"), signer.armoredPublicKey)).toThrow();
  });
});
