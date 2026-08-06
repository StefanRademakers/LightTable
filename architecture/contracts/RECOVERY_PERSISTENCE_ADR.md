# Recovery persistence ADR

Status: accepted for P0 implementation, 6 August 2026.

## Decision

LightTable keeps crash recovery separate from the user's explicit Save target.
Recovery v1 writes bounded, versioned, complete native snapshots after semantic
commits. It uses newest-work backpressure, a quiet-period debounce and a maximum
dirty age. It never observes pointer moves, viewport changes, overlay animation
or a periodic timer on an unchanged document.

Electron stores recovery under an application-owned `recovery-v1` subdirectory
of `app.getPath('userData')`. The browser stores it in OPFS when available and
reports quota/durability failures honestly. Recovery is never uploaded.

Each record contains a random recovery ID, hashed document/source identities,
canonical revision, history state ID, saved state ID, timestamps, byte length,
native artifact checksum and schema version. Electron also records the source
name/path/type and workspace position needed for an intelligible restore UI;
that metadata envelope is encrypted with Electron `safeStorage` and is never
written as clear-text index data. The snapshot itself necessarily contains
document content and receives private per-installation filesystem permissions
where the host supports them.

Recovery uses the crash-safe prepared-file publication from Task 083. Per
installation only one write may run. An edit during a running write does not
queue every intermediate state: at most the newest revision is handed off after
the current write settles. A verified explicit Save removes records through the
committed revision; failed/canceled saves do not.

At startup LightTable validates and lists recovery before ordinary recents.
Preview and Open always operate on a separate dirty recovered copy; they never
replace the original. The desktop host checks the original source path and
labels missing/moved or newer originals explicitly. A per-record attempt marker
prevents bulk restore from repeatedly reopening a document implicated in the
previous crash; the existing document runtime boundary keeps that failure from
closing other recovered documents. Saving or explicitly discarding the copy
removes both its checkpoint and attempt marker.

## Why snapshot-only v1

The existing native container already preserves the canonical document tree,
text, vectors, styles, off-canvas bounds, imported provenance and required
assets. A command-only journal is smaller but not independently sufficient:
commands can change across builds, may reference renderer-owned raster history,
and require a known-good base plus migration semantics. Shipping it as the sole
recovery truth would trade measured write cost for a larger corruption surface.

Snapshot-only is therefore the correctness baseline. Task 107 remeasures small,
TextTest, shapes, EHS-396 and large styled documents. Content-addressed immutable
assets or snapshot-plus-bounded-delta may replace it only if those measurements
miss interaction budgets and canonical roundtrip/fault tests remain equal.

## Measured implementation baseline

The packaged Windows/Electron build was measured on the production renderer,
not a mocked serializer:

- TextTest plus one new vector layer: 466 KiB; native preparation 359.5 ms;
  atomic persistence 19.7 ms; no page error. A second run measured 325.3 ms
  preparation and 20.5 ms persistence.
- After that checkpoint, verified Ctrl+S wrote the 466 KiB native document and
  left zero recovery generations, proving save cleanup happens after commit.
- The packaged recovery smoke force-terminated an edited TextTest session,
  found recovery before recents after restart, loaded its preview, opened it as
  a visibly dirty recovered copy, saved it to a new target, observed checkpoint
  cleanup and reopened the save with an equal canonical layer projection. The
  smoke also checks keyboard focusability and records four visual checkpoints.
- The 178,264,877-byte EHS-396 PSD remained interactive during a checkpoint:
  after import there were zero main-thread tasks above 50 ms. Its complete
  native snapshot did not finish inside a 150-second observation window. No
  partial recovery file was published.
- A clean/unchanged scheduler produced one initial dirty checkpoint and zero
  additional writes across a simulated two-minute idle interval.

The EHS result is not accepted as a performance target. Snapshot-only remains
the v1 correctness format because partial command replay is not yet safe, while
Task 107 owns content-addressed asset reuse/delta measurement and must make the
large-document path practical before release qualification. Atomic metadata-
last publication means an interrupted baseline attempt is invisible rather
than corrupt.

## Scheduling defaults

- debounce after a semantic commit: 5 seconds;
- maximum dirty age before attempting a checkpoint: 30 seconds;
- at most one in-flight checkpoint per installation;
- at most two valid generations per document;
- at most 20 documents, 30 days and 2 GiB per installation;
- quota/disk failure retains the newest prior valid generation and is reported;
- an inactive but dirty document may checkpoint once; unchanged inactive
  documents schedule no recurring work.

These are bounded defaults, not compatibility data. Task 107 may tune them from
recorded p95/p99 interaction and storage results.

## Primary-source findings

- Adobe separates **Save in Background** from **Automatically Save Recovery
  Information**, and describes recovery as interval-based crash information.
  Photoshop's documented default is ten minutes, configurable down to five.
  <https://helpx.adobe.com/ca/photoshop/desktop/save-and-export/save-files/file-saving-properties-and-preferences.html>
  <https://helpx.adobe.com/photoshop/kb/file-recovery-photoshop.html>
- Adobe warns that large-file background saving and auto-recovery consume
  performance/scratch resources. LightTable therefore measures ordinary input
  latency rather than treating asynchronous work as free.
  <https://helpx.adobe.com/photoshop/desktop/troubleshoot/performance-stability-issues/troubleshoot-scratch-disk-full-errors-in-photoshop.html>
- Electron defines `userData` as per-user application configuration storage and
  recommends an app-specific subdirectory rather than mixing files with
  Chromium-owned directories.
  <https://www.electronjs.org/docs/latest/api/app#appgetpathname>
- Node documents that promise filesystem calls use the threadpool but are not
  synchronized/threadsafe, and that `FileHandle.sync()` flushes queued data.
  LightTable consequently serializes recovery publication explicitly.
  <https://nodejs.org/api/fs.html#promises-api>
- The File System Standard exposes synchronous OPFS access handles only to
  dedicated workers, with exclusive locking and explicit `flush()`/`close()`.
  <https://fs.spec.whatwg.org/#api-filesystemsyncaccesshandle>
- Browser storage quota and usage are implementation-defined estimates; OPFS
  writes can fail with quota exhaustion and site-data clearing removes them.
  <https://storage.spec.whatwg.org/#usage-and-quota>
  <https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system>
- Electron `safeStorage` protects small strings through OS facilities but has
  platform-dependent availability and semantics. It is not a bulk-document
  encryption API; v1 avoids sensitive cleartext index fields instead.
  <https://www.electronjs.org/docs/latest/api/safe-storage>

## Rejected alternatives

- **Overwrite the source periodically:** violates explicit Save ownership and
  can destroy the user's last intentional version.
- **One snapshot per edit:** produces unbounded work and worker/storage queues.
- **Timer-based polling:** wakes unchanged/background documents without a
  semantic reason.
- **Command log as sole truth:** replay and migration are not yet safe for all
  raster/GPU-backed commands.
- **localStorage:** string-only, small and inappropriate for document snapshots.
- **Cloud recovery by default:** conflicts with local-first privacy and is not
  required for crash recovery.
