# Bun / Hono server

The server serves the built React frontend, WASM, import API and range requests
for the local game library. The browser executes the game; the server does not
render it. One process owns one library.

From the repository root, `bun dev` builds the client and starts the local wizard.
WASM and a validated extraction helper must already be prepared. See
[web development setup](../../../README-WEB.md) and
[server installation](../../docs/SERVER-INSTALL.md) for prerequisites, commands
and the current helper packaging limitation.

The current launcher binds to `127.0.0.1`, uses a tokenized local URL and writes
library resources under `--data` (development default: `.data/`). It is not yet
an authenticated public hosting service. Linux extraction, reverse-proxy origin
configuration, storage recovery and resumable imports are pending.

The target distribution is a single private Docker container with a persistent
`/data` volume; no game content ships in the image. See the
[release design](../../docs/DISTRIBUTION.md). Gameplay progress currently lives in
the browser and is not part of the server library backup.

Run backend checks from the repository root:

```sh
bun run --cwd web/apps/server typecheck
bun run --cwd web/apps/server test
```
