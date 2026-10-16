# Static distribution

The web build is now a static site. The previous Bun/Hono backend, Dockerfile,
Compose/Render service definitions and native web extraction helper were removed.
Native PC installers/build tooling are separate and unchanged.

## Build and deploy

```sh
bun install --frozen-lockfile
bun run build:wasm
bun run build
```

The WASM step requires Emscripten; see `packages/engine-wasm/scripts/build.sh`.
Publish only `web/apps/client/dist` on an HTTPS static host. With Render, create a
**Static Site**, not a Web Service. If the host build environment lacks Emscripten,
build locally or in CI and deploy the resulting folder. No server secrets, upload
service, Docker image or persistent volume is required.

Serve `.wasm` as `application/wasm` and JavaScript as JavaScript. Preserve all emitted
files and their relative names; do not rewrite module requests to index.html.
JS, CSS and WASM filenames carry a content-derived fingerprint of the complete
runtime graph. Changing any runtime file changes the graph's filenames, including
workers and WASM loaders. The build rewrites HTML and module references together.
This deliberately invalidates the whole runtime rather than individual chunks.

Deploy complete builds atomically. Serve `index.html` with `Cache-Control: no-cache`
so clients revalidate it; fingerprinted assets can use long immutable caching.
Purge previously cached HTML and legacy unversioned files when rolling out this
change, then hard-refresh existing browser tabs. Hashing does not purge existing
browser/CDN caches or force already-open tabs to update. Retain prior fingerprinted
assets during deployments if old tabs need to keep loading lazy modules.
This app has no route rewrites. No browser library/save keys change between builds.
HTTPS is needed for WebGPU/OPFS outside localhost. The user's GPU runs the game.

## User flow

1. Open the site and choose a compatible fPKG from their own dump, or the three
   already-extracted archives.
2. A dedicated Worker extracts locally into a staged OPFS library. Progress and
   cancellation are visible. No package/game bytes reach the hosting service.
3. After validation, the active library pointer is replaced; failed imports retain
   the previous library. Click Play. Game progress uses localStorage checkpoints.
4. Reopen the same site/profile to continue. Restart is an explicit menu action.

Retail PKGs are unsupported. OPFS quota/persistence and browser WebGPU support
still determine whether a device can run the port. Clearing site data removes
library and saves. Old library generations currently consume space until site data
is cleared; safe reclamation is a remaining milestone.

## Release artifact

Ship a versioned ZIP of the **code-only static dist**, corresponding source/revision,
licenses/notices and checksums. Generated JS/WASM belong in release artifacts,
never in source control. Include the replaceable LGPL extractor's corresponding
source and license; dependencies keep their licenses. Do not include PKGs, archives,
`.data`, test fixtures, captures or decoded game content. Review the package before
publication. No release/publication is performed automatically.

There is no claim that browser-local storage resolves all rights questions for the
port; it removes hosting of the user's game files from this architecture.

## Remaining distribution work

- Normal-profile restart and Firefox/Safari compatibility acceptance.
- Safe old-generation/crash-orphan cleanup and explicit library deletion.
- User-facing save export/import for domain/device changes.
- Optional application-code offline cache and recovery from interrupted deployments.
- Release packaging/CI and full gameplay/audio/rendering acceptance on hosted builds.

Gameplay remains through f070; see ROADMAP.txt. Static distribution does not extend
the playable boundary.
