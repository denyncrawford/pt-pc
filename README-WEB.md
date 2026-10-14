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
verification. Build the self-contained .NET 10 extraction helper using
`tools/macos/build_local_extractor.sh`; see [helper setup](web/apps/server/README.md).
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

## Current gameplay

The intro, original menu, hallway resources and initial loop progression are
implemented. PhotoOption shares puzzle state between the menu and stages; the
remaining fragments and later progression are unfinished. See the dated status
in [the roadmap](web/docs/ROADMAP.txt). Historical entries describe earlier
checkpoints, not the current completeness level.

## Publication and distribution

`bun run audit:publication` audits staged changes relative to the native baseline.
It rejects added binaries, local data directories and private path markers.
Game archives, extracted resources, captures, caches and generated output must
never be included in source commits or release images. Upstream code and
third-party license notices are retained.

The server remains loopback-only. A local release bundle is the next recommended
milestone; a private Docker image follows Linux-helper validation. See
[the distribution plan](web/docs/DISTRIBUTION.md) for acceptance gates.

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
