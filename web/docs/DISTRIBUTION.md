# Distribution and user-supplied assets

Status: proposed architecture, not a shipped release or public hosting clearance.
Updated 2026-10-14. Preserve root `bun dev`, React wizard and browser WASM/WebGPU.

## Decision

Confirmed scope: users deploy their own instance; the developer instance is for
personal use. Prioritize a code-only, single-user self-hosted Docker image and
Compose configuration; a local desktop bundle remains a secondary distribution
option. Render, Railway and AWS are possible deployment targets, not yet selected
or validated. Build storage behind an interface with persistent and ephemeral
modes. Public multi-user hosting is outside the current release scope. No game library, PKG, screenshots, decrypted content or keys
are included in release archives, images or build caches.

A volume and a session are complementary: the volume is the disk backing store;
the session controls ownership, retention and authorization. A Docker named volume
persists independently of its container; restarting a container is not deletion.
Use disk-backed storage for large packages, not tmpfs (memory-backed, potentially
swapped). Avoid requiring an upload/extraction to finish in one serverless request.

## Distribution modes

| Mode                                    | Where assets live                                                      | Retention                                                                               | Release order                         |
| --------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------- |
| Downloadable local launcher             | User's machine                                                         | Keep imported library until user deletes it; remove source upload after verified import | Secondary                             |
| Private Docker server                   | Operator's mounted disk volume                                         | Persistent library or explicitly selected expiring sessions                             | First                                 |
| Public managed service                  | Isolated private disk/session storage; optionally object storage later | Expiring, with explicit delete and quotas                                               | Outside current scope                 |
| Public static frontend + local importer | User's device; public host serves code only                            | Local user policy                                                                       | Alternative feasibility investigation |

A weaker client still executes WASM, rendering and audio. Remote asset storage does
not remove WebGPU or GPU requirements. Cloud video streaming is outside this plan.

## First self-hosted release contract

- One private instance, one owner, one active game library. Multi-user accounts,
  tenant storage, object storage and a distributed job queue are not prerequisites.
- Publish a code-only Docker image plus Compose example. The operator supplies
  storage and their own PKG using the existing wizard. No sample game library.
- Default to persistent mode: a disk-backed `/data` volume retains the verified
  library across restarts; uploaded PKG files are deleted after import commits.
- Offer ephemeral mode: bounded local scratch storage, explicit delete and expiry,
  startup cleanup and a clear re-upload state when the deployment loses its disk.
  A mounted volume is optional in this mode, not a requirement for ordinary play.
- Keep saves/settings separate from asset retention so a small persistent state
  volume can coexist with temporary game assets.
- Compose binds loopback by default. A remotely reachable personal deployment needs
  HTTPS and access control (for example an authenticated reverse proxy or private
  network). “Single user” does not make an internet-facing upload endpoint private.
- Choose a long-running container service that supports the Linux extractor,
  writable scratch disk, sufficient disk/RAM and large/resumable uploads. Verify
  provider-specific limits before publishing a deployment template.
- Implement lifecycle correctness first, Linux image second, resumable imports
  third. Add provider templates only after testing the same image on each target.

## Current implementation and gaps

The Bun import service already streams request bytes to disk (8 GiB input cap),
extracts to a unique directory, atomically replaces the library pointer after
success, and removes uploaded PKG bytes in finally. Assets use allowlisted names
and HTTP ranges. Import requires an entire upload before extraction starts.

There is one active library and one busy flag per process. A tokenized URL and
loopback binding serve local use; neither is a multi-user ownership model. Old
successful library directories are not automatically garbage-collected. Process
crashes can leave uploads, extraction directories or locks behind. There is no
resumable upload protocol, persistent job queue, session expiry or per-user quota.

## Storage model

Proposed writable layout (outside the image and application source):

    /data/state/                    # SQLite on one host: owners, jobs, leases, progress
    /data/sessions/<opaque-id>/
      upload/source.pkg.part       # incomplete upload
      upload/source.pkg            # finalized verified upload, temporary
      staging/<job-id>/            # extractor output, never served
      library/                     # atomically published authorized asset set

Expose opaque resource identifiers, never user-supplied filesystem paths. Store
original filenames only as untrusted display metadata. A failed new import leaves
the previous valid library usable. Clean superseded libraries only after their
readers/jobs release leases. Save-game metadata has a separate retention policy;
keeping a save must not implicitly keep the game's asset files.

A persistent Docker volume can back both retention modes. Session expiry is an
application job, not a Docker restart side effect. Also support disposable scratch
disks: loss of those bytes returns the wizard to “select your copy” instead of
claiming a recoverable library exists. Persisting only metadata cannot recover lost
assets. On a single host, SQLite and disk are enough; defer distributed databases,
Redis and object storage until deployment requires multiple workers/hosts.

## Upload and import flow

1. Establish owner/session and reserve disk quota. Preflight input size and available
   disk; extraction output and scratch space have separate enforced budgets.
2. Create a resumable upload. Prefer a tus-compatible implementation if Bun/runtime
   compatibility is validated; otherwise use a dedicated tus service behind Bun's
   authorization. Do not invent unbounded parallel chunk buffering.
3. Transfer bounded chunks to disk with backpressure, offset validation and checksums.
   Show uploaded/total bytes, retry and cancel. Authenticate every request; an upload
   identifier is not sufficient authorization.
4. Finalize once the expected length/checksum is verified. Enqueue an idempotent job
   and return immediately; extraction does not hold the upload request open.
5. Run the extractor as a restricted worker: non-root, no network, bounded CPU,
   memory, output disk, runtime and concurrency. Validate its output paths and
   manifest before atomic publication; do not serve staging files.
6. Delete the source PKG once import commits. Progress reports true phases:
   uploading, verifying, extracting, preparing, ready. Do not fake extraction
   percentages when the helper cannot report total work.
7. The browser requests authorized byte ranges from the imported library while it
   plays. Stage/GPU loading has its own progress after server import is ready.
8. Cancel, explicit delete, expiry and restart reconciliation converge on the same
   idempotent cleanup service. Delete partial uploads and unpublished output after
   worker termination, not while extraction can still write them.

Proposed states:
created → uploading → queued → extracting → ready → deleting → deleted
with failed/cancelled/expired paths, retry rules and per-job leases.

Suggested defaults for an eventual hosted pilot, to validate against real play:
24 hours to resume an incomplete upload; 2 hours idle expiry for a ready session;
24-hour maximum asset retention. Active authorized playback renews an idle lease
but not the absolute deadline. Warn before expiry. Closing a tab is not a reliable
delete signal. Startup reconciliation plus a periodic sweeper enforce retention;
a crashing process must not make cleanup depend on finally blocks.

## Public-service isolation (not present today)

Use authenticated owner-bound sessions and secure cookies with CSRF protection,
TLS, configured trusted public origin and proxy rules. Bind 0.0.0.0 only as an
explicit container setting. Authorize every status, upload, range, retry and delete
request. No shared global active-library pointer, public asset URLs, cross-user
hash deduplication or asset CDN in the first implementation. Exclude session asset
directories from backups and logs; document residual storage-provider retention.
Deletion removes accessible files, not a promise of physical secure erasure.

When multiple hosts become necessary, evaluate private S3-compatible multipart
uploads with short-lived owner-scoped grants, checksum validation and explicit
abort/expiry. Extraction still requires suitable worker scratch storage. Object
storage lifecycle is a cleanup backstop, not an immediate deletion guarantee.
Do not add this network/storage complexity to the first single-host release.

## Legal release gate

User-supplied content, private sessions and short retention do not automatically
make hosting lawful. The repository MIT license expressly covers port code only;
it does not license P.T. content. Possession of a PKG does not itself establish a
right to upload it to a third-party service. Noncommercial intent, delisting and
preservation goals are not blanket permissions.

As a US example, Section 512 may limit liability for qualifying storage at a
user's direction. It is conditional protection, not a content license. Relevant
conditions include designated-agent registration, notice/takedown handling,
repeat-infringer policy and knowledge/financial-benefit rules. Whether this
specific game's extraction-and-play service qualifies needs legal assessment;
adding an upload checkbox or takedown email is not sufficient assurance.

Access-control circumvention is a separate Section 1201 question. Preservation
exemptions are narrow; the discontinued-game preservation provision for eligible
libraries, archives and museums does not broadly authorize an online public game
service, and includes physical-premises restrictions. Do not assume “abandonware”
or a free-to-play release eliminates copyright or circumvention issues.

Before operating public uploads, identify the operator, hosting and target-user
jurisdictions; have qualified counsel assess asset copying/serving, extraction,
licenses, intermediary rules, privacy and provider terms. Permission from the
relevant rightsholder is the clearest route for hosted game-content distribution.
Self-hosting or keeping files on users' devices reduces our custody of content;
it does not certify every use or the extractor as lawful. No jurisdiction has yet
been specified for this plan, so US sources are illustrative, not global advice.

## Milestones and acceptance

1. **Local packaging — secondary/pending.** Reproducible build of client, WASM, Bun launcher
   and versioned companion extractor; macOS arm64 first, then tested Linux targets.
   Preserve licenses, produce checksums/SBOM and inspect release inputs. Test a
   machine without Bun, .NET or Emscripten installed. No helper download magic.
2. **Storage lifecycle — pending.** Storage configuration, manifests, atomic imports,
   startup orphan cleanup, safe stale-lock recovery, explicit library deletion,
   superseded-library leases and disk limits. Test interruption in every import
   phase, disk-full, cancellation, repeated import and restart. Keep bun dev.
3. **Private Docker — primary distribution target/pending.** Linux helper validation; multi-stage image with an
   explicit allowlisted build context, non-root/read-only app filesystem, mounted
   disk storage and graceful shutdown. Test persistent and disposable data modes,
   real range streaming, TLS browser access and amd64/arm64 separately.
4. **Resumable wizard — pending.** Validate tus compatibility, ownership, progress,
   resume, cancel, checksums and asynchronous import jobs. Test proxy disconnects,
   duplicate finalize, stale offsets and output-size limits. Add truthful loading UI.
5. **Public multi-user hosted pilot — out of scope/gated.** Legal decision, authentication, tenant isolation, leases,
   quotas, deletion, abuse response and operations. Demonstrate that user A cannot
   read or affect user B's library; verify expiry after worker/process crashes.

Measure upload/import time, peak disk/RAM, range throughput and startup latency.
Peak disk includes input PKG + staged extracted data + previous live library +
extractor scratch, multiplied by allowed concurrent imports. Set actual quotas
from measurements; input size alone is insufficient. Verify deletion with a disk
inventory after three upload/play/delete/restart cycles.

## References reviewed

- [Docker volumes](https://docs.docker.com/engine/storage/volumes/)
- [Docker tmpfs](https://docs.docker.com/engine/storage/tmpfs/)
- [tus resumable upload protocol](https://tus.io/protocols/resumable-upload)
- [S3 multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [US Copyright Office: Section 512](https://www.copyright.gov/512/)
- [Section 512 statutory text](https://www.govinfo.gov/content/pkg/USCODE-2024-title17/html/USCODE-2024-title17-chap5-sec512.htm)
- [Current Section 1201 exemption regulation](https://www.copyright.gov/title37/201/37cfr201-40.html)
- [US Copyright Office: 2024 Section 1201 proceeding](https://www.copyright.gov/1201/2024/)

No application behavior changes, commits, uploads or pushes are part of this plan.
