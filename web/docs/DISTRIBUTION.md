# Distribution plan

Status: proposed, not a released container or standalone binary.

The client continues to execute WASM/WebGPU and audio in the browser. The server
imports a user's PKG into a private disk directory and supplies authorized byte
ranges. A release must contain code and redistributable dependencies only.

## Recommended order

1. **Local release bundle (next milestone).** Build Bun server, browser modules,
   WASM and a self-contained extractor for each supported OS/architecture. Supply
   one launcher that chooses a free loopback port and opens the wizard. Start with
   macOS arm64 (the currently tested extractor target), then validate Linux and
   Windows. The user should not install Bun, .NET or Emscripten. Keep the native
   helper as a versioned companion executable first; embed/extract it only after
   testing executable permissions, signatures and updates.
2. **Private Docker deployment.** Build a Linux extractor and a multi-stage image
   from explicit code inputs, with prebuilt browser/WASM output. Use a non-root
   runtime, writable volume for the library, bounded disk upload workspace, and
   graceful cleanup. No assets, PKG files, screenshots or developer caches may
   enter the build context or image layers. Publish amd64/arm64 only after real
   import and browser tests on both targets.
3. **Hosting.** Add explicit bind address/public origin configuration, TLS proxy
   support, authentication and session isolation, quotas, cancelled upload cleanup,
   stale lock recovery and restart tests. The current loopback host is intentionally
   not a public multi-user service. A token URL alone is not multi-user isolation.

## Decisions and acceptance gates

| Area | Required before release |
| --- | --- |
| Reproducibility | Pinned Bun, Emscripten, .NET SDK, extractor sources and dependency checksums; build from a clean checkout |
| Packaging | Include web HTML, compiled modules, WASM, notices and helper; test on a machine without dev tools |
| User experience | Launch → choose PKG → progress → game; useful errors and retry without re-uploading valid libraries |
| Container import | Linux helper works; uploaded PKG spooled to disk; no complete archive buffered in RAM |
| Ephemeral hosts | Separate temporary upload from optional persistent library; survive interruption without publishing half-imports |
| Browser access | HTTPS for non-local WebGPU clients, correct range/MIME/isolation headers; test weaker client hardware |
| Quality | Typecheck, synthetic tests without game data, private integration suite with user-provided assets, three resource lifecycle cycles |
| Provenance | Audit staged source and image contents; dependency licenses/SBOM/checksums; game assets remain user-provided |

Docker is suited to an already-managed server. A downloadable local launcher is
likely the simpler first experience for desktop users; both use the same client
and server. Do not ship an untested Dockerfile as if it solves Linux extraction,
TLS or isolation. Existing PKG import uses the .NET helper even though the HTTP
server is Bun.

## TypeScript follow-up

Client, server, tools and tests are TypeScript. Generated Emscripten glue remains
JavaScript; native engine code stays C/C++. The current compiler configuration is
permissive: explicit `any` remains around legacy resource assemblers, native ABI
exports and test doubles. No `@ts-nocheck` is used. Before claiming strict typing,
replace these boundaries with scene, sequence, material and audio message schemas,
then enable strict null and implicit-any checking module by module.

## Primary references checked 2026-10-14

- [Bun standalone executables](https://bun.sh/docs/bundler/executables): runtime
  bundling and OS/architecture targets. Disk-discovered resources and the helper
  still need an explicit packaging strategy.
- [Bun Docker guide](https://bun.sh/guides/ecosystem/docker): multi-stage builds and
  a non-root runtime.
- [WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API): browser
  availability and secure-context requirements.
