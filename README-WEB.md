# P.T. Web port

A static React/TypeScript application with WebGPU rendering and the shared C++
engine compiled to WASM. There is **no application backend**. The browser extracts
your own compatible fPKG in a Worker, stores the three archives in OPFS, and saves
progress/settings in localStorage. No game content is uploaded or distributed.

**Bring your own copy.** This unofficial web demo does not include, host or distribute
P.T., PKG files, extracted game assets, or links to download the game. You must
provide your own lawfully obtained copy and have the necessary rights to use it.
Your game files are processed and stored locally in your browser; they are never
uploaded to the demo host. This project is not affiliated with or endorsed by
Konami. Game content and trademarks belong to their respective owners. The
project's software license does not grant any rights to the original game content.

## Development

Install Bun and the Emscripten SDK, then from the repository root:

```sh
bun install
bun run build:wasm
bun dev
```

Open http://127.0.0.1:3000. Vite rebuilds when source files change; reload the page
after a completed build. This watches emitted engine modules rather than using HMR.
Choose **Import your copy** and select your fPKG, or select `chunk1.psarc`,
`texture.qar` and `pathid_list_ps4.bin` together from your existing extraction.
A retail PlayStation Store package is not supported. Keep your original files.

For a production build and a local preview:

```sh
bun run build
bun run preview
```

Preview opens at http://127.0.0.1:4175. Build the WASM first if it is missing.
Deploy `web/apps/client/dist` to any HTTPS static host. See
[distribution](web/docs/DISTRIBUTION.md). Neither Docker, .NET, Bun nor a persistent
server volume is required **on the hosting service**. Bun/Emscripten are build tools.

## Storage and progress

Files stay in OPFS; progress and options stay in localStorage. Reloading, leaving
and re-entering resumes the saved checkpoint. Only the explicit **Restart** action
resets progress. Importing a library does not reset it. Saves are checkpoints, not
snapshots of every animation frame; an unfinished event may replay after reload.

Storage is specific to the origin and browser profile. Ports 3000 and 4175 have
separate libraries/saves. Keep the same deployed domain. Clearing site data deletes
both files and saves; private browsing and quota policies can restrict persistence.
There is no cross-device synchronization or guaranteed offline app loading.

## Workspace

- `web/apps/client`: React UI, gameplay/rendering, local library and extractor Worker.
- `web/packages/pkg-extractor`: typed, bounded fPKG/PFS/PFSC reader; LGPL adaptation
  of LibOrbisPkg using noble crypto and fflate, with no native runtime dependency.
- `web/packages/engine-wasm`: Emscripten bridges to repository `src`.

Each owns its package manifest. Builds are generated, ignored by Git and contain
no game data. Original menus still render their user-provided assets on WebGPU.

## Verification

```sh
bun run typecheck
bun test web/packages/pkg-extractor/tests web/apps/client/tests/save-game.test.ts
bun run build
bun x playwright install chromium
bun run --cwd web/apps/client test:local
```

Browser tests are headless and use isolated profiles. Optional `PT_TEST_PKG` and
`PT_TEST_LIBRARY` point to private local fixtures, never committed assets. The
large-fixture Chromium tests grant a 4 GiB test quota; users' available quotas vary.
See [local storage details](web/docs/LOCAL-STORAGE.md) for limitations.

## Current gameplay

Enabled route: `f000 → f010 → f005 → f020 → f030 → f040 → f060 → f050 → f070`.
The bathroom chain, flashlight, baby/mirror events, XMark portrait interaction,
solved-portrait exit, and f070 window/Lisa/glass/breath events are integrated.
World photo fragments and the menu fragment share their separate puzzle state.

**f080 and subsequent loops/ending remain unavailable.** Unsolved f050 repetition
and pursuit, audiovisual fidelity, lighting/shadows and event-related stalls remain
open. Native ray tracing/upscalers, advanced controller support and extras are not
all ported. This is not the full native game. The gameplay checkpoint is unchanged;
resume with f080 Freezer, then f090 Hello. See the [roadmap](web/docs/ROADMAP.txt)
and [event register](web/docs/REGISTRO-EVENTOS.txt).
