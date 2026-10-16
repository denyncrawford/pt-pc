# Local library and saves

The static app imports **fPKG directly in a dedicated Worker**, or accepts the
three extracted files (`chunk1.psarc`, `texture.qar`, `pathid_list_ps4.bin`). The
Worker reads bounded ranges, opens fPKG → outer PFS → PFSC → inner PFS, then writes
only those fixed output names to OPFS. It uses TypeScript/noble/fflate; no .NET
runtime or additional extraction WASM is needed. The game engine still uses WASM.

This replaces the former OPFS proof of concept and server-backed importer.
Retail console PKGs are unsupported. Archive signatures and the `pt14_` path
marker are validated; not all package signatures/digests are authenticated.

## Integrity and cancellation

Imports serialize through Web Locks. A fresh generation receives files in 2 MiB
write chunks. The active manifest is committed only after all files close. Failed
or cancelled imports delete their partial generation and preserve the active
library. Browser shutdown can leave an orphan generation; automatic safe cleanup
is pending. Previous complete generations are retained because another tab may be
reading them. The original selected PKG is never copied into OPFS or uploaded.

Persistent storage is requested but browsers can decline. Quota estimates are
advisory; writes can still fail. HTTPS/localhost, OPFS and Web Locks are required.
Browser/profile/origin changes do not migrate files or saves. Neither application
code offline caching nor cross-device synchronization is implemented.

## Progress

`pt-web-progress` and its recovery slot live in localStorage, alongside settings.
Existing save format/keys are retained. Importing files, closing the menu or
reloading does not reset progress. Explicit Restart resets checkpoint/puzzle state;
it does not delete the library. An in-progress sequence may replay from its saved
checkpoint. Clearing browser site data removes everything.

## Validation

The TypeScript extractor's complete output SHA-256 hashes match the existing native
extractor for the privately tested US fPKG. Private files are never test fixtures
in the repository. Pure tests cover bounds, independent OpenSSL XTS vectors for
both key derivations, PFSC decompression and malformed metadata. Headless browser
tests cover OPFS reload, cancellation, failed replacement and local saves.
Optional real-package tests exercise the actual Worker and load hallway geometry
and collision from its persisted output with no backend requests. Large tests
explicitly override Chromium's isolated-profile quota to 4 GiB; that is not a
promise of quota availability on user devices.

See [web setup](../../README-WEB.md) for commands and DISTRIBUTION.md for hosting. Normal-profile relaunch,
other browsers and complete audiovisual route acceptance remain separate checks.

Full private extraction parity can be reproduced with:

```sh
bun tools/web/verify-local-extractor.ts /path/to/private.pkg /path/to/native-extraction
```
