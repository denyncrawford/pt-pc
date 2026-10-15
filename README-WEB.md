# P.T. Web port

Bun server, React/TypeScript browser UI, WebGPU rendering and the shared C++ engine
compiled to WASM. This is an incomplete gameplay port. No PKG or extracted game
assets are included; use your own local copy through the wizard.

## Development

With the WASM modules and extraction helper prepared:

```sh
bun install --frozen-lockfile
bun dev
```

Bun invokes Vite with SWC and React Compiler to build the browser modules, opens the local wizard and reuses an
existing `.data/` library. Keep the terminal open; Ctrl+C stops the server.
`bun dev --no-browser` prints the URL without opening a browser.

For a fresh checkout, put Emscripten on PATH (tested with 6.0.12), then run
`bun run build:wasm`. GLM, Lua and audio codebooks are downloaded with checksum
verification. The .NET 10 helper build script is `tools/macos/build_local_extractor.sh`;
its multi-file output needs packaging before use with the current launcher. See
[helper requirements and installation](web/docs/SERVER-INSTALL.md).
The HTTP server is Bun; .NET is used only by the helper during import.

## Layout

- `web/apps/client/src/`: feature `modules`, archive `lib`, remote `services`, and `types`.
- `web/apps/server/src/`: Bun entrypoint, `routes`, `services`, `http` and `lib`.
- `web/packages/engine-wasm/src/`: C/C++ bridges to the native engine in `src/`.
- `web/apps/client/dist/` and `web/packages/engine-wasm/dist/`: generated outputs, ignored by Git.
- `web/apps/client/vite.config.ts`: Vite/SWC/React Compiler configuration.
- `web/apps/client/scripts/build.ts`: Vite build entry; `web/packages/engine-wasm/scripts/build*.sh`: separate WASM builds.
- `.data/` and `.cache/`: private local libraries and build/helper dependencies.

The client is built before the Bun server starts; this command does not currently
run a separate Vite HMR server. Reload/restart after source edits. Stable module
URLs preserve session-scoped asset streaming and audio-worklet loading.
The pinned SWC plugin exposes React Compiler through its documented advanced
options hook; the bundle test verifies compilation of both React views.

## Verification

```sh
bun run typecheck
bun run build
bun test
```

Tests use synthetic fixtures by default. A built WASM core is required for native
parser/physics tests. To run the optional private integration suite:

```sh
PT_TEST_PSARC=/path/to/chunk1.psarc PT_TEST_QAR=/path/to/texture.qar bun test --timeout 120000
```

No test assets or generated builds are checked in. `web/packages/engine-wasm/src/` is source only;
`bun run build:wasm` is a separate native build step. `bun dev` tells you if it is missing.

`bun run typecheck` checks the complete project and a strict subset with
`noUncheckedIndexedAccess`: React components, options parsing, HTTP range transport,
GPU allocation tracking and stage lifecycle. Those modules contain no explicit `any`.
The renderer/WASM bridge remains permissively typed; full strict coverage is unfinished.
React owns wizard and web-setting state. The original game menu keeps its native
canvas renderer (including the puzzle), with an imperative adapter at that boundary.
Browser DOM types are still needed for canvas/input/browser APIs, not as a UI framework.

The web interface and original options menu use English. New installations default
to English subtitles; existing subtitle preferences are preserved and other game
subtitle languages remain selectable.

## Current gameplay

As of 2026-10-16, the enabled route is:

`f000 → f010 → f005 → f020 → f030 → f040 → f060 → f050 → f070`

The bathroom chain, flashlight, baby/mirror events, XMark portrait interaction,
solved-portrait exit, and f070 window/Lisa/glass/breath events are integrated.
The five world photo fragments and menu fragment share their separate puzzle
state. Saves retain the floor, photo state and portrait state in browser storage.
**f080 and subsequent loops/ending remain unavailable.** Unsolved f050 repeats
and pursuit are also unfinished. Logical route tests and isolated GPU checks do
not certify complete audiovisual fidelity. Lighting/shadows and event-related
frame stalls remain open. Native graphics enhancements and extras are not all
ported; do not apply the native README's feature list to the web build.

Gameplay is paused at this checkpoint while distribution is prepared. Resume
from the Freezer events in f080, then Hello f090; see the current block at the top
of [the roadmap](web/docs/ROADMAP.txt) and [event register](web/docs/REGISTRO-EVENTOS.txt).

## Server installation and releases

Follow [server installation](web/docs/SERVER-INSTALL.md) for the current source
setup and the proposed private deployment. The current server binds to loopback;
a ready-to-deploy Linux container is **not yet delivered**. Do not expose the
local launcher directly to the internet.

The primary delivery target is one Docker image containing Bun/Hono, the built
React frontend, WASM modules and a validated Linux extraction helper. GHCR will
host versioned images; GitHub prereleases will hold a deployment kit, checksums,
license notices and matching source information. A mounted `/data` retains the
user's imported library. Progress currently stays in the browser, not that volume.
See [the distribution plan](web/docs/DISTRIBUTION.md) for release gates.

`bun run audit:publication` audits **staged source changes** relative to the
native baseline. It is not an audit of untracked files, an image, or a release.
PKG files, extracted resources, private captures, caches and local outputs must
never enter published source or images. Application JS/CSS/WASM and helper builds
are generated from source for releases and are deliberately excluded from Git.
Preserve upstream attribution and third-party license/source obligations.

## Workspace ownership and typing

Each app/package owns its package.json and build/test commands. The root commands
coordinate the workspace. Run a client-only check with
`bun run --cwd web/apps/client typecheck`, or backend tests with
`bun run --cwd web/apps/server test`.

The backend is checked in strict mode. Client settings, wizard, range access,
archive parsers, stage lifecycle and GPU resource ownership also have strict
checks with unchecked-index protection. Legacy renderer, audio and WASM ABI
modules still contain `any`; migrating those contracts is pending. React owns
application UI; browser/WebGPU types remain necessary for engine integration.
