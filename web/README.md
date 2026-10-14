# Browser workspace

See [setup](../README-WEB.md), [roadmap](docs/ROADMAP.txt), and
[distribution](docs/DISTRIBUTION.md).

- `apps/client`: Vite + React app; source grouped under `src/modules`, `lib`, `services`, `types`.
- `apps/server`: Bun app; `src/routes`, `services`, `http`, `lib`.
- `packages/engine-wasm`: C/C++ browser bridges and independent Emscripten build.

Each owns a package manifest. Tests and tooling live outside application source.
All `dist` folders are generated and excluded from Git. Native engine source stays
in the repository-level `src`. Root `bun dev` builds the client and starts Bun.

## HTTP and formatting

The server uses Hono for routing and middleware on Bun. `src/app.ts` builds the
HTTP app without opening a socket; `src/main.ts` owns process startup and shutdown.
PKG imports pass the raw request stream to the library service.

Run `bun run fmt` to format the web workspace with Prettier, or `bun run fmt:check`
to verify it. This covers TypeScript/TSX, JSON, HTML and Markdown; native C/C++
and shell sources use their existing formatting. Generated output is excluded.

## Frontend styles

Tailwind CSS 4 uses the Vite plugin and Preflight. `src/styles/app.css` contains
imports and minimal base rules; components own their utility classes. `index.html`
is only the Vite document shell. `main.ts` mounts a single React `App`.

`components/` owns the viewport, dialogs and developer controls; `hooks/use-session.ts`
owns loading and menu state. The typed `GameRuntime` contract separates React from
the engine. The renderer publishes view state through `useSyncExternalStore` and
only draws pixels into canvas refs. The original menu still renders its original
resources on WebGPU. Store-reading components opt out of compiler memoization
because the engine mutates its external state; the other views use React Compiler.

This is one session with overlays, so it needs no router. Future navigable screens
should use generouted. Run `bun dev` as before.
