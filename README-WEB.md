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

Bun bundles React locally and builds the TypeScript browser modules, opens the local wizard and reuses an
existing `.data/` library. Keep the terminal open; Ctrl+C stops the server.
`bun dev --no-browser` prints the URL without opening a browser.

For a fresh checkout, put Emscripten on PATH (tested with 6.0.12), then run
`bun run build:wasm`. GLM, Lua and audio codebooks are downloaded with checksum
verification. Build the self-contained .NET 10 extraction helper using
`tools/macos/build_local_extractor.sh`; see [helper setup](web/server/README.txt).
The HTTP server is Bun; .NET is used only by the helper during import.

## Layout

- `web/client/`: React wizard/settings, TypeScript renderer/audio, native menu and tests.
- `web/server/`: Bun HTTP server, range streaming and PKG import.
- `web/wasm/src/`: C/C++ bridges to the native engine in `src/`.
- `web/client/dist/`: generated JS and WASM, ignored by Git.
- `web/web-build.ts`: TypeScript-to-browser build; `web/build*.sh`: WASM builds.
- `.data/` and `.cache/`: private local libraries and build/helper dependencies.

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

No test assets or generated builds are checked in. `web/wasm/src/` is source only;
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
in [the roadmap](web/server/ROADMAP.txt). Historical entries describe earlier
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
