# Recovery release qualification — 6 August 2026

Status: passed for the Windows packaged-desktop and browser-storage P4 gate.

## Reproduce

```powershell
npm run package:desktop
npm run profile:desktop:recovery -- --output=tmp\quality-audit\recovery
npm run profile:browser:recovery -- --output=tmp\quality-audit\browser-recovery
```

The desktop profile opens each fixture in the packaged Electron build, creates
one canonical raster layer, measures viewport input-to-frame before, while
queued, during preparation and after publication, then restarts the process and
opens the recovered copy. It records JSON plus pre-crash/restored PNG evidence.
The browser profile runs the real OPFS adapter contract with quota and failed-
publication seams and emits JSON. Neither profile uses mocked document export.

## Acceptance policy

- Small-document viewport p95: at most 33 ms or 1.25× that document's baseline.
- Large-document viewport p95 during recovery: at most 1.25× its measured
  baseline; recovery must not introduce a new interaction class.
- Recovery-phase long task: at most 100 ms or 1.25× an already slower document
  baseline. The final run's maximum was 50 ms.
- Viewport, pointer and overlay-only activity: zero additional checkpoints.
- Restore: canvas dimensions and canonical layer count equal; normalized visual
  RMSE at most 8. Normalization removes launcher viewport scale/position only.
- Heap is garbage-collected before/after; no case may show unbounded growth.

## Final packaged results

| Fixture | Source | Queued p95 | During p95 | Post p95 | Prepare | Persist | Artifact | Restore | RMSE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| agent-release-card.lighttable | 1.4 MiB | 17.4 ms | 17.4 ms | 17.2 ms | 71.1 ms | 17.8 ms | 0.1 MiB | 1.412 s | 6.33 |
| shapes.psd | 0.2 MiB | 17.1 ms | completed before sample | 17.1 ms | 41.9 ms | 16.6 ms | 0.1 MiB | 1.445 s | 0.01 |
| TextTest.psd | 0.9 MiB | 17.0 ms | 20.7 ms | 17.3 ms | 189.2 ms | 31.5 ms | 0.4 MiB | 1.418 s | 3.30 |
| EHS-396.psd | 170.0 MiB | 53.9 ms | 57.8 ms | 53.4 ms | 2.107 s | 316.0 ms | 25.0 MiB | 4.485 s | 6.17 |

Heap deltas after forced collection were 0.1–0.9 MiB. All cases wrote one
checkpoint, produced zero viewport-only checkpoints, restored the newest
canonical revision and passed visual comparison. EHS recovery activity is now
close to its normal renderer cost rather than the earlier 561–573 ms stall.

## Fault and storage matrix

Desktop tests cover termination/failure at prepare, write, flush, validate,
replace, serialize, publish and prune; explicit Save overlap; permission and
disk failures; malformed and unsupported records; clock jumps; repeated corrupt
startup listing; bounded generations/documents/bytes. Every failed publication
preserves the previous valid generation.

Browser tests cover estimate-based quota refusal, quota failure after artifact
write but before metadata publication, cleanup of partial artifacts, missing or
truncated artifacts, malformed metadata, pruning and no fallback that could
claim false durability. OPFS remains best-effort local recovery: site-data
clearing can remove it and quota is implementation-defined.

## Primary-source review

The Task 084 decision remains aligned with current primary material:

- Adobe continues to separate background Save from automatic recovery and
  warns that recovery/background work uses storage and performance resources.
  <https://helpx.adobe.com/ca/photoshop/desktop/save-and-export/save-files/file-saving-properties-and-preferences.html>
- Electron's current `userData` documentation warns against storing large files
  there because they may be cloud-backed. LightTable's root is isolated and
  bounded today; host-configurable relocation remains advisable.
  <https://www.electronjs.org/docs/latest/api/app#appgetpathname>
- Node filesystem promises use the threadpool but are not synchronized;
  `FileHandle.sync()` is still the explicit flush primitive. The one-writer
  queue and prepared-file replace remain required.
  <https://nodejs.org/api/fs.html#promises-api>
- OPFS synchronous access remains worker-only/exclusively locked, while browser
  quota remains an estimate. Metadata-last publication remains correct.
  <https://fs.spec.whatwg.org/#api-filesystemsyncaccesshandle>
  <https://storage.spec.whatwg.org/#usage-and-quota>

## Remaining non-blocking observation

EHS normally renders viewport zoom commands around 54 ms p95 on this machine,
independent of recovery. That is a compositing/large-document performance item,
not an autosave regression, and belongs in the global performance pass.
