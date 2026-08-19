# Photoshop Actions research and LightTable direction

Status: research applied to the first LightTable Actions vertical slice, 2026-08-19

## Question

What should LightTable learn from Photoshop's Actions panel while building a
single semantic command surface for UI, local Actions, Agent Access and MCP?

This is product research, not a Photoshop compatibility claim. Adobe's current
desktop documentation and developer reference are the source for Photoshop
behavior; LightTable code and command tests remain authoritative for our app.

## Primary Adobe sources

- [Use the Actions panel](https://helpx.adobe.com/photoshop/desktop/automate-tasks/automation-settings-and-presets/use-the-actions-panel.html)
- [Record an action](https://helpx.adobe.com/photoshop/desktop/automate-tasks/create-record-actions/record-an-action.html)
- [Play and manage actions](https://helpx.adobe.com/photoshop/using/playing-actions.html)
- [Batch-process files](https://helpx.adobe.com/photoshop/desktop/automate-tasks/process-a-batch-of-files/batch-process-files.html)
- [Insert a non-recordable menu command](https://helpx.adobe.com/photoshop/desktop/automate-tasks/create-record-actions/insert-a-non-recordable-menu-command.html)
- [Add conditional actions](https://helpx.adobe.com/photoshop/using/conditional-actions-creative-cloud.html)
- [Record tools in actions](https://helpx.adobe.com/photoshop/using/recording-tools-actions-cs6.html)
- [Adobe Photoshop UXP batchPlay details](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/)

The Adobe help site could not be connected to directly from this development
session, so its current pages were retrieved as text through an HTTP reader.
The URLs, titles and page bodies above are Adobe-owned. The UXP developer
reference was fetched directly from Adobe.

## What Photoshop actually models

### Panel and organization

- An action is an ordered sequence of recorded menu commands, tool operations
  and panel adjustments.
- Actions can be grouped into sets. The panel exposes the action and its steps,
  supports editing a step, and offers Stop, Record and Play controls.
- A recorded action can have a name, function-key shortcut and display color.
- Photoshop also provides a compact Button mode for fast playback, but the
  editable step hierarchy is the important authoring model.

### Playback and history

- Current Adobe documentation says an action is applied as one History step by
  default, so the whole playback can be undone together. Advanced workflows can
  change that behavior.
- Individual commands can be excluded, reordered, rerecorded or have their
  settings changed.
- A step can request a dialog during playback instead of always replaying the
  recorded values silently.
- Stops can pause an action and present instructions. Conditional steps choose
  a Then or Else action based on a bounded document condition.

### Recording limits

- Photoshop acknowledges that some operations are not recordable and permits
  insertion of a menu command for those cases.
- Tool recording is opt-in. Brush/tool operations therefore do not silently
  become part of every recording.
- Recorded actions often depend on active documents, selections, layer names or
  the UI context that existed while recording. That is convenient, but it is a
  major source of brittle reuse.

### Batch processing

- Photoshop's Batch command applies one loaded action to opened files, selected
  files or folders.
- File Open and Save As steps have explicit override behavior. Batch processing
  can suppress open-option dialogs and color-profile warnings, traverse nested
  folders and choose whether results remain open, overwrite originals or go to
  another folder.
- These controls show that file orchestration is not just another recorded edit:
  source selection, destination policy, warnings and overwrite behavior require
  their own validated boundary.

### Developer-level command representation

- Photoshop UXP `batchPlay` accepts ordered Action Descriptors and returns one
  result per descriptor.
- A descriptor names a command, explicit or active targets, parameters and
  execution options. Adobe recommends stable object IDs over indices because
  indices change when objects are inserted or removed.
- State-changing calls run in a modal execution scope. Multiple commands can be
  grouped into one History state; execution normally stops on the first error.
- Photoshop can copy recorded action steps as JavaScript/actionJSON and can log
  action descriptors in developer mode. This makes the Actions panel a useful
  discovery instrument for its lower-level command system.

## Decisions for LightTable

### Adopt

1. A visible, searchable Actions panel with product categories.
2. Expandable command details: stable ID, description, scope, effect class,
   current availability and Agent/MCP rollout state.
3. Local Play through exactly the same typed application command service used
   by UI automation and adapters.
4. Later: named sets, ordered steps, Stop/Play/Record controls and one logical
   History entry for one successful action playback.
5. Later: explicit interactive/modal steps, stops and bounded conditions rather
   than hidden prompts during unattended playback.
6. Later: batch source/destination policy as a separate host-owned workflow,
   never as unvalidated paths embedded in recorded steps.

### Improve rather than copy

- Recording stores semantic command IDs and validated parameters, not DOM
  events, menu coordinates or component callbacks.
- Persistent documents and layers are addressed by stable IDs or explicit
  relative target bindings. A step that depends on "whatever is active" must
  declare that dependency visibly.
- Continuous tools record a bounded semantic gesture or completed tool command,
  not an unbounded pointer-event stream.
- Each step carries availability/precondition information before playback.
  Playback fails closed before mutation when a required target or capability is
  absent.
- Local availability, Agent Access admission and external MCP admission are
  separate catalog fields. Local recording never silently expands remote access.
- Parameter editors are typed projections of command schemas. LightTable will
  not add a generic JSON textarea that effectively becomes a second public API.

### Defer

- Recording arbitrary UI interactions before command coverage is truthful.
- Photoshop `.atn` import/export; its descriptors do not map one-to-one to the
  LightTable document model.
- Droplets or unattended filesystem batches before overwrite, recovery,
  cancellation and host permission policies are complete.
- General conditional scripting. Start with a small declarative condition set
  only when real workflows justify it.

## Implemented foundation

The first slice established command discovery:

- command definitions now carry category, label, description, scope, effect,
  invocation type and explicit rollout reasons;
- a pure catalog projection joins those definitions to live command capability
  results and handles search/category filtering;
- the dockable Actions panel displays that projection;
- only parameter-free commands can currently Play locally, and they execute
  through `LightTableCommandService`;
- parameterized commands remain discoverable but cannot be run until they have
  typed parameter editors;
- no document, history, renderer or MCP implementation was added to the panel.

The second slice adds bounded semantic recording without adding a parallel
executor:

- recording observes `LightTableCommandService.execute`, so UI, local Actions
  and future MCP callers have one capture point;
- each observed step contains the command, document target, transport-safe
  parameters, outcome, bounded result, timing and replayability status;
- rejected commands remain visible for debugging but are not replayable;
- undo, redo and task cancellation remain diagnostic steps rather than saved
  design instructions;
- recordings are capped at 256 steps, 256 KiB per captured value and 2 MiB in
  total so the panel cannot become an unbounded document log;
- the packaged desktop smoke records a layer creation triggered through the
  normal Layer menu plus an undo triggered from Actions, then inspects both
  command-service steps in the recorder.

This is not playback yet. There are no saved sets, target variables, gesture
coalescing, parameter editing or one-history-entry action transactions.

## Next implementation order

1. Generate parameter descriptors from the same validated command contracts.
2. Add typed editors for a representative target command, numeric command and
   structured command; verify UI and local Actions yield equivalent state.
3. Inventory all menus, shortcuts, panels, context menus and tools against the
   catalog, including justified query/gesture/presentation classifications.
4. Add named local action sets, target variables and ordered semantic steps.
5. Normalize bounded gestures before admitting paint/slider/transform streams
   to saved actions.
6. Add preflight plus step-debug playback, atomic rollback and optional
   one-History-entry behavior.
7. Admit categories to Agent Access/MCP only after their local Actions flow,
   validation, undo and representative rendered result have passed.
