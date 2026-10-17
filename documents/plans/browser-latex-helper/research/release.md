sha: 3159f508
files: packages/browser/manifest.chrome.json
source: https://nodejs.org/docs/latest-v22.x/api/single-executable-applications.html, https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging, https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests, https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging, https://developer.chrome.com/docs/extensions/reference/manifest/key, https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/optional_permissions, https://bugzilla.mozilla.org/show_bug.cgi?id=1630415, https://developer.apple.com/library/archive/documentation/DeveloperTools/Reference/DistributionDefinitionRef/Chapters/Distribution_XML_Ref.html, https://jrsoftware.org/ishelp/topic_runsection.htm, https://jrsoftware.org/ishelp/topic_registrysection.htm, https://signpath.org/terms, https://docs.signpath.io/trusted-build-systems/github, https://github.com/actions/attest, https://cli.github.com/manual/gh_attestation_verify, https://support.apple.com/en-us/102445, man pkgbuild(1)

## Node 22 SEA (v22 docs)
- CommonJS bundle; `sea-config.json` `{"main":"app.js","output":"sea-prep.blob"}`; `node --experimental-sea-config sea-config.json`; `cp $(command -v node) host`.
- macOS `codesign --remove-signature host`; Windows `signtool remove /s host.exe` (optional).
- `npx postject host NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` (+ `--macho-segment-name NODE_SEA` on macOS).
- macOS `codesign --sign - host`. `--build-sea` only from v25.5.0.

## Host manifest, user level
- Chrome: macOS `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json`, Linux `~/.config/google-chrome/NativeMessagingHosts/`, Windows `HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\<name>`. Chromium: same under `Chromium` and `~/.config/chromium/`.
- Edge: `HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\<name>`; Linux `~/.config/microsoft-edge/NativeMessagingHosts`.
- Firefox: `~/Library/Application Support/Mozilla/NativeMessagingHosts/`, `~/.mozilla/native-messaging-hosts/`, `HKCU\SOFTWARE\Mozilla\NativeMessagingHosts\<name>`.
- Firefox: `allowed_extensions: ["id@example.org"]`; Chromium: `allowed_origins: ["chrome-extension://<id>/"]`, no wildcards. `path` absolute on macOS/Linux.
- .deb system dirs: `/etc/opt/chrome/`, `/etc/chromium/`, `/etc/opt/edge/` (each `native-messaging-hosts/`), `/usr/lib/mozilla/native-messaging-hosts/`.
- Brave, Vivaldi paths: unverified.

## macOS pkg
- `pkgbuild --root payload --identifier <id> --version <v> --install-location <path> --scripts scripts out.pkg`; `scripts/postinstall` runs. `productbuild --distribution dist.xml --package-path . out.pkg`.
- `<domains enable_anywhere="false" enable_currentUserHome="true" enable_localSystem="false"/>`; home install runs as the user, writes only in home.
- Relative `--install-location` under home, and postinstall `$HOME`/`$USER`: unverified.

## Inno Setup
- `PrivilegesRequired=lowest`; `{userappdata}`/`{localappdata}` as per-user paths: unverified.
- `[Registry] Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\<name>"; ValueType: string; ValueName: ""; ValueData: "{app}\<name>.json"; Flags: uninsdeletekey`
- `[Run] Filename: "{app}\host.exe"; Flags: runhidden waituntilterminated`; `[UninstallRun]` same, runs first.

## .deb (unverified)
- `dpkg-deb --build --root-owner-group pkgdir out.deb`; `DEBIAN/control`: Package, Version, Architecture, Maintainer, Description; `postinst`, `prerm` 0755.

## SignPath Foundation
- OSI license without commercial dual-licensing, no malware, maintained, built from source on CI, manual release approval, MFA, version metadata. (signpath.org/terms)
- Policy page (home and download pages): credits SignPath.io free signing and SignPath Foundation certificate, lists team roles and members, links privacy policy.
- `upload-artifact@v4+`, then `signpath/github-action-submit-signing-request@v3`: `api-token`, `organization-id`, `project-slug`, `signing-policy-slug`, `github-artifact-id`, optional `artifact-configuration-slug`, `output-artifact-directory`.

## Provenance
- `actions/attest-build-provenance` v4 wraps `actions/attest`: `id-token: write`, `attestations: write`; input `subject-path` (or `subject-digest`+`subject-name`).
- `gh attestation verify <file> --repo <owner>/<repo>`.

## Extension id from `key`
- `openssl genrsa 2048 > key.pem`; key: `openssl rsa -in key.pem -pubout -outform DER | base64 | tr -d '\n'`; id: `openssl rsa -in key.pem -pubout -outform DER | openssl dgst -sha256 -binary | head -c 16 | xxd -p | tr '0-9a-f' 'a-p'`. Derivation rule: unverified in Chrome docs.
- Store item id: put the dashboard public key (Package tab, View public key) in `key`.

## Optional nativeMessaging
- Firefox: optional since 87 (bug 1630415). Chrome: no stated exception, version "125" unverified.

## macOS 15
- Open the pkg, then System Settings > Privacy & Security > Open Anyway > Open. Control-click removal: unverified.

## Extension ids

- Chrome unpacked (`key` in `packages/browser/manifest.chrome.json`): `ghcjlkjggiffdekaneoaoklhedjeeklh`. The private key stays out of the repo; the unpacked id needs only the public key. A Web Store item gets its own id; putting the dashboard public key in `key` makes unpacked builds match the store id and replaces this one.
