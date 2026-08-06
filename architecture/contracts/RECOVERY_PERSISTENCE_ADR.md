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

## Release qualification (6 August 2026)

The packaged Windows/Electron build now passes the repeatable Task 107 profile
against native, shapes, TextTest and EHS-396 documents. EHS-396 is a 170 MiB,
42-layer styled PSD and is the large-document qualification case. During its
checkpoint, viewport command-to-frame p95 was 57.8 ms versus 53.9 ms while the
checkpoint was queued and 53.4 ms after publication. Preparation took 2.107 s,
atomic persistence 316 ms, the artifact was 25.0 MiB and restore in a new
packaged process took 4.485 s. The three small cases stayed between 17.4 and
20.7 ms p95 during a checkpoint.

Recovery uses an exact-size transparent container preview. The preview is not
canonical document data; avoiding a full-resolution GPU composite/readback
removed a measured 561-573 ms interaction stall on EHS. Layer pixels, text,
vectors, styles, masks and preserved assets remain complete. All four restored
documents matched canvas dimensions and layer count; normalized pre-crash vs
restored canvas RMSE ranged from 0.01 to 6.33 under the documented threshold of
8. Zero viewport-only checkpoints and no recovery-phase long task over 50 ms
were observed. The committed machine-readable baseline is
`test/baselines/recovery/windows-2026-08-06.json`.

Raster and derived-preview PNG encoding runs in one lazy worker. Unchanged
encoded assets are reused in a bounded 128 MiB LRU cache. Artifact hashing for
files over 4 MiB also runs in a worker and transfers the prepared buffer to the
desktop bridge, avoiding a second renderer-side file read. These optimizations
change scheduling and reuse only; they do not change canonical pixels.

## Scheduling defaults

- debounce after a semantic commit: 5 seconds for sources below 32 MiB, 30
  seconds for larger sources;
- maximum dirty age before attempting a checkpoint: 30 seconds for sources
  below 32 MiB, 120 seconds for larger sources;
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
- Electron defines `userData` as per-user application configuration storage,
  warns that large files there may be backed up to cloud storage, and recommends
  a different directory for large files. Recovery remains in an app-owned
  `recovery-v1` subdirectory for v1 isolation and bounded pruning; relocating
  the root is a host policy option before broad distribution.
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
