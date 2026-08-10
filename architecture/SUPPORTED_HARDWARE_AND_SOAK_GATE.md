# Supported hardware and release soak

Status note (10 August 2026): the recorded qualification sample belongs to
historical candidate `2643a94c`. Its probe and policy remain reusable, but
current support claims require fresh physical measurements on a new candidate.

LightTable does not infer hardware support from a fast development machine.
The current public minimum-performance claim is **unavailable** until the same
production soak passes on physical machines representing every claimed class.
The gate below defines the candidate floor and produces the evidence needed to
turn that candidate into a support claim.

## Candidate hardware floor

| Class | Candidate floor | Provisional target | Claim state |
| --- | --- | --- | --- |
| Windows discrete | Windows 11 x64, current D3D12/WebGPU driver, 4+ physical CPU cores, 16 GiB RAM, 4 GiB dedicated GPU memory, 1920x1080 at 100-200% scale | 16.7 ms direct manipulation; ordinary first useful frame <= 1 s | Partial: measured only on the development RTX 5090 system. |
| Windows integrated | Windows 11 x64, current D3D12/WebGPU driver, 4+ physical CPU cores, 16 GiB dual-channel RAM, modern integrated GPU | 33.3 ms direct manipulation; ordinary first useful frame <= 2 s | Unavailable until a run is forced to and verified on the integrated adapter. |
| macOS / Apple GPU | To be set from physical Apple Silicon evidence | Unavailable | Unavailable. |
| Linux and other GPU backends | Not selected for the first desktop release | Unavailable | Unsupported for the current release candidate. |

These are engineering gates, not marketing promises. A WebGPU adapter must be
identified by the bounded diagnostic bundle; merely listing a GPU in the OS is
not proof that Chromium selected it. Driver, OS, display scale and build mode
are part of every result's validity metadata.

The renderer now enforces a capability floor before creating a device: at
least an 8192 pixel 2D texture limit and a 256 MiB maximum buffer. Adapters
below either limit are refused with an actionable message; LightTable does not
silently lower document resolution. A 16384 pixel texture limit and 1 GiB
maximum buffer is classified as candidate-recommended capability. Capability
is deliberately separate from physical qualification: passing the limit check
does not claim acceptable latency, memory retention or fidelity on that device.

`npm run probe:hardware -- --output <directory>` opens the packaged build and
writes `probe.json` plus an Ed25519 `probe.signature.json`. The artifact contains
bucketed machine/display data, WebGPU limits/features, driver revision and the
benchmark revision. It excludes names, paths, document content, host/user names
and network identifiers. Local development probes use a freshly generated key
and identify their trust as `ephemeral-local`; release evidence must provide a
controlled PKCS#8 Ed25519 key through `LIGHTTABLE_PROBE_SIGNING_KEY`.

## Repeatable profiles

```powershell
# Bounded production CI/review sample
npm run soak:desktop:release:build -- --profile ci

# One-hour local soak
npm run soak:desktop:release:build -- --profile local

# At least twelve hours, unattended
npm run soak:desktop:release:build -- --profile overnight
```

`--cycles`, `--iterations`, `--duration-minutes` and `--output` allow explicit
bounded runs. The overnight preset requests 720 minutes. A shorter run records
`not-measured` extrapolation and can never be presented as twelve-hour proof.

The desktop and full quality profiles include the bounded CI soak after one
production package. Detailed logs are capped and artifacts are written below
`tmp/quality-audit/release-soak/`; they are not shipped or committed.

## Scenario and measurement contract

Every cycle covers an ordinary PNG, `TextTest.psd`, `shapes.psd`,
`FormulierPersoneel.pdf` and EHS-396. It repeatedly exercises open, ready/first
frame, layer selection and visibility, panels, pan/zoom, selection, paint,
transform, text create/caret/edit, Layer Style input, save/export, PSD semantic
roundtrip, process close and reopen. Specialized tests remain the authoritative
owner for detailed canvas, type, style, accessibility/save and PSD assertions;
the soak orchestrates them instead of duplicating mutation code.

Measurements stay separate:

- input-to-submit and input-to-GPU completion come from the Type Tool trace;
- final settle is measured after the action and two animation frames;
- first useful frame comes from startup phase metadata after `ready`;
- heap, DOM and listeners use forced-GC stable tails;
- owned GPU bytes come from renderer ownership estimates;
- unchanged background submissions come from reset render telemetry;
- page/runtime/WebGPU failures and newly orphaned LightTable processes are
  exact-zero gates.

Zero actions, zero text samples, missing first-frame metadata, stopped runtimes,
missing/non-positive GPU ownership or absent final render samples are invalid,
not fast. Mutation/history residency is reported separately from the warm
non-mutating canvas tail; paint undo resources must not be mislabeled as a
leak. Early/deferred screenshots are evidence only after a ready, settled,
positive-GPU sample.

## 6 August 2026 development-system evidence

The longest practical run for Task 089 used three independent production
cycles and four document-matrix iterations per file (255.4 seconds total) on
Windows 11 build 26200, Core Ultra 9 285K, 64 GiB RAM and the selected NVIDIA
Blackwell adapter (RTX 5090 driver 32.0.15.9595). It is **not** a twelve-hour or
integrated-GPU result.

- all three cycles, five document classes and all specialized scenarios passed;
- page/runtime/WebGPU errors and newly orphaned processes: zero;
- unchanged 750 ms windows: zero submitted frames for every document/cycle;
- ordinary first useful frame: 758-764 ms; EHS-396: 1714-1773 ms;
- non-mutating canvas stable tail: zero DOM and listener growth; the final
  checked run records owned-GPU delta explicitly;
- Layer Style 120-event gesture: no long task and bounded ~16.6 Hz publishing;
- Type Tool remained a parity gap: 32.9-65.3 ms input-to-submit and
  67.7-117.6 ms input-to-GPU across the three cycles.

The machine-readable evidence is
`tmp/quality-audit/release-soak/task-089-longest-practical/report.json`. The
text latency is not release-quality Photoshop parity and remains a measured
performance priority; the green lifecycle gate must not conceal it.

## 6 August 2026 Task 109 qualification sample

The current Windows discrete/Electron cell was re-probed against the packaged
build and passed one complete bounded release-soak cycle. The selected adapter
was the NVIDIA device (vendor `0x10de`, device `0x2b85`, driver
32.0.15.9595), at 1920x1080 and device scale 1. Its WebGPU limits were 16384
pixels, 2 GiB maximum buffer and approximately 2 GiB maximum storage binding,
therefore its capability tier is `candidate-recommended`.

All document matrix, canvas/transform, text, layer-style, accessibility,
save/export, PSD roundtrip and bounded-diagnostics steps passed. First useful
frames were 787 ms for the ordinary image, 425 ms for TextTest, 361 ms for
shapes, 740 ms for the PDF and 1962 ms for EHS-396. The two text samples
measured 36.1 ms p95 input-to-submit and 64.1 ms p95 input-to-GPU. No orphaned
LightTable process remained. This is a bounded functional sample, not an
overnight claim.

The committed summary is
`test/baselines/hardware/windows-discrete-electron-2026-08-06.json`; raw probe,
signature and logs remain below `tmp/hardware-qualification/`. Windows web,
Windows integrated and Apple Silicon cells remain explicitly unqualified until
they are exercised on their real host/GPU combinations. Consequently the old
candidate never established a public minimum specification.
