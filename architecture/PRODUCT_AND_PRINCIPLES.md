# Product and principles

## Product direction

LightTable is a modern, AI-first professional image and art editor. It starts
from the familiar strengths of Photoshop, Camera Raw, Lightroom and Resolve,
but is free to remove historical UI and implementation constraints. The goal
is not a browser demo or a collection of filters: it is a responsive editor
that can become a commercially viable desktop product while retaining a full
web build.

The traditional tools are the foundation. The differentiating workflows come
afterward: aligning imperfect AI edits, retaining the highest-quality source,
masking and compositing useful regions, reversible processing, and eventually
AI operations that behave like first-class document operations rather than
one-shot exports.

## Non-negotiable principles

- Web and Electron run the same editor package and document engine.
- LightTable owns its UI, CSS, icons, workers, tests and runtime assets.
- StoryBuilder is a host integration, not an architectural dependency.
- WebGPU handles high-volume pixel and vector work. TypeScript coordinates
  state and command flow; workers/Wasm handle suitable CPU codecs and analysis.
- Internally, color processing is linear and alpha is premultiplied unless a
  contract explicitly says otherwise.
- Editing is non-destructive by default. Destructive rasterization is an
  explicit user operation, not a shortcut around missing architecture.
- No hidden global grade. Processing has a visible owner in the layer model.
- Missing executors, invalid data and unsupported PSD semantics are reported;
  they do not silently change to a convenient approximation.
- Performance is part of correctness: pointer input must remain responsive,
  inactive documents must not render, and unchanged stages must remain asleep.
- The user-facing editor should feel coherent and compact. Shared controls and
  design tokens are preferred over feature-local lookalikes.

## Compatibility policy

LightTable is in alpha. Its internal document format has no legacy guarantee;
old alpha files may be ignored when keeping them would add branches or weaken
the model. Establish, version and document the public LightTable format before
the first real release. The long-term format should be open even if the app is
commercial.

PSD/PSB compatibility is different: it is a product capability and validation
source. Import must preserve the semantics LightTable already supports—layer
order, groups, transforms, clipping, masks, blends, adjustments, styles and
assets—rather than merely showing Photoshop's embedded flat composite. The
embedded composite can be used transiently as a visual truth/reference, but it
must not be duplicated inside a saved LightTable document.

Compatibility is an adapter boundary, not the authority for LightTable's
internal model. Photoshop concepts are translated into native LightTable
layers, masks, processing nodes and assets. We pursue behavioral parity where
artists depend on it, but we do not copy Photoshop's historical internals or
force its UI structure into the product. When an exact mapping is unavailable,
the importer reports that explicitly instead of weakening the native model.

LightTable's document structure, rendering contracts and interaction design
remain leading. Its UX may be more direct than Photoshop's while still making
imported semantics visible, editable and testable. Native capabilities are not
limited to the PSD feature set: future 3D layers, AI-generated or live content,
new vector content and additional GPU processing nodes must fit as typed scene
nodes and registered executors rather than one-off editor exceptions.

## Quality bar

Every feature should move through a small loop: implement, test, inspect,
improve, verify in web and desktop, then commit. A prototype may expose an
incomplete algorithm, but it may not corrupt unrelated documents, bypass the
undo model, own unexplained state, or block the normal fast image path.
