Run from the repository root: bun dev
The browser wizard selects a PKG, imports it and opens the walkable hallway.
HTTP server: Bun.serve. Frontend: browser modules + WebGPU/WASM.
Local assets: .data/ (ignored). Extraction helper: .cache/extractor/ (ignored).
Existing imports are detected. No game assets are committed.

The current Mac has the extraction helper prepared. For a fresh checkout,
PT_EXTRACTOR can point at a self-contained PT.MacExtract built from
installer/MacLocal using tools/macos/build_local_extractor.sh and patched
LibOrbisPkg. The single-file helper must include its runtime dependencies.
Bun is the HTTP backend; .NET is only used by this helper during PKG import.

Tests: bun test (range tests); package test script also runs web parser tests.
Current scope: original architectural hallway with native WASM collision. Full gameplay and public hosting remain pending.
