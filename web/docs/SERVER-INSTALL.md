# Installing the web port on a server

Status: **development preview, 2026-10-16**. No production Docker image or Compose
release is provided yet. This page separates today's supported source setup from
the target deployment. Do not use native PC release binaries as a web server.

## How the deployment works

One Bun/Hono service serves the React static files, WASM modules, import API and
range requests for the imported library. The browser runs rendering, audio and
gameplay. No GPU is needed on the server for rendering; the player's browser and
GPU must support WebGPU. Remote browser access requires HTTPS.

The first release targets one owner and one private library. It is not a public
multi-user upload service. You provide your compatible fPKG; the application does
not download the game. Store-encrypted PKGs are not supported by the extractor.

## Run the current source version locally

Run from the repository root. Install the Bun version declared by `package.json`
and activate Emscripten (tested version: 6.0.12) first:

```sh
bun install --frozen-lockfile
bun run build:wasm
bun run build
```

PKG import also requires the extraction helper. The current helper build script
is for macOS arm64, requires .NET 10 and patched LibOrbisPkg sources, and takes two
arguments:

```sh
bash tools/macos/build_local_extractor.sh /path/to/patched-LibOrbisPkg /path/to/helper-output
```

**Packaging caveat:** that script emits a multi-file publish directory, whereas
the current Bun launcher copies only the executable into its runtime directory.
Do not assume its output is a working self-contained import helper. A validated
helper with its dependencies packaged is required; an existing prepared helper
can be selected with `PT_EXTRACTOR`. Fixing and testing this packaging mismatch
on a clean machine is a distribution blocker.

With that helper prepared, start the built app without opening a browser:

```sh
PT_EXTRACTOR=/absolute/path/to/validated/PT.MacExtract \
  bun run --cwd web/apps/server start --data /absolute/path/to/pt-library --no-browser
```

Open the exact `PT_WEB_URL` printed in the terminal on the same machine, select
your PKG, wait for import and start playing. The current server listens only on
`127.0.0.1`; this is a local source setup, not an internet deployment command.
Keep the process running and stop with Ctrl+C. For development, `bun dev
--no-browser` rebuilds the client and uses the repository `.data` directory.

Do not run two servers against the same library. A stale lock after an unexpected
exit currently needs investigation; never delete a live process's lock blindly.

## Planned Docker server installation

These are release requirements, **not commands for an image available today**:

1. Download the deployment kit from a versioned **web prerelease** in this fork.
   Verify its published checksums and review its known limitations.
2. Install Docker with Compose on a supported Linux host. Initial target is
   `linux/amd64`; publish `linux/arm64` only after independent validation.
3. Configure the supplied environment example with your public HTTPS origin,
   private access configuration and pinned image digest. The kit must contain no
   shared/default password. Actual variable names will be documented when built.
4. Create the persistent library volume at `/data`. Keep the app and imported
   resources behind the same authenticated HTTPS origin. For a managed host,
   attach its persistent disk at the same path and preserve range requests.
5. Start the supplied Compose stack with `docker compose up -d`. For a managed
   host, deploy the same pinned image and configure its port, disk and healthcheck.
6. Sign in, upload your copy, follow import progress, then play. Upload/extraction
   failures must allow retry without replacing an existing working library.
7. Restart the service and verify the library still loads. Reopen the same browser
   and origin to verify that the gameplay checkpoint remains available.

Do not allocate storage based only on the final library size: peak usage includes
input PKG, staged extraction, previous active library and helper scratch. The
current input limit is 8 GiB; that is neither a required disk size nor a measured
RAM requirement. Publish measured minimums and proxy/upload limits with the release.

## Updates, saves and backups

The container image contains software only. `/data` holds imported user resources;
a successful import removes the uploaded source PKG. Replacing the image must not
replace the volume. Back up the volume with the app stopped before an update, and
keep the previous image digest. Do not remove volumes when stopping the stack.
Rollback must be checked against any storage migration, not just an older tag.

**Current saves/settings live in the browser, separately from `/data`.** Changing
the domain, browser/profile or clearing site storage can make progress unavailable.
A server-volume backup does not back up those saves. Cross-device save sync and a
supported save export/import flow are future work; do not advertise them yet.

## Release blockers

- Linux helper build, dependency packaging and real import on a fresh host.
- Configurable bind address/public origin; current Host/Origin checks assume the
  local listener URL and cannot simply be placed behind a remote reverse proxy.
- Authentication on API, static and game-resource requests; stable session flow.
- Resumable upload, asynchronous extraction, bounded storage and crash recovery.
- Non-root container, writable scratch paths, healthcheck and graceful shutdown.
- Reproducible image, artifact audit and license/source notices for dependencies.
- Private HTTPS smoke test: import → play → restart → continue → update → continue.

Gameplay remains limited to f070. See [web limitations](../../README-WEB.md),
[checkpoint](ROADMAP.txt), and [release design](DISTRIBUTION.md).

References: [Docker volumes](https://docs.docker.com/engine/storage/volumes/),
[WebGPU secure context requirement](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API),
[Railway volumes](https://docs.railway.com/volumes),
[Render persistent disks](https://render.com/docs/disks).
