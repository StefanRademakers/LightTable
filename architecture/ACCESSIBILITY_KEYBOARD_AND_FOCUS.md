# Accessibility, keyboard and focus

LightTable's core open-edit-save path is keyboard-operable in the desktop and
web hosts. Accessibility behavior belongs to shared UI primitives and command
routing; it must not trigger canvas recomposition or add work to pointer hot
paths.

## Keyboard contract

- Plain `Tab` and `Shift+Tab` follow native focus order. LightTable does not
  suppress tab navigation globally.
- Photoshop-compatible tool shortcuts continue to work outside editable text.
  Text inputs and active Type Tool editing own printable keys and editing
  shortcuts instead of leaking them to the editor router.
- `Ctrl` on Windows/Linux and `Cmd` on macOS invoke the same document commands.
- Native Electron application menus remain disabled. Menus, flyouts, dialogs
  and font pickers use an exclusive native-keyboard scope. The Layers tree uses
  tab-only isolation: local navigation remains native while document commands
  such as mask invert still work after choosing a layer or channel.
- `Escape` closes the nearest transient surface and returns focus to its
  opener. `Enter` or `Space` activates buttons and menu entries. Disabled menu
  commands remain discoverable, carry `aria-disabled`, explain their state in
  a title, and never execute.

## Surface inventory

| Surface | Current keyboard and semantic behavior |
| --- | --- |
| Start, recovery and document-error surfaces | Native named buttons in document order; shared dialogs trap focus and restore it on close. |
| Application menu and context menus | `menubar`, `menu` and `menuitem` semantics; arrows, Home/End, submenu left/right, Escape and opener restoration. |
| Toolbar and tool-family flyouts | Named buttons; active/expanded state; Arrow Down opens a family; arrows and Home/End move within it. |
| Options bar and font picker | Native labelled controls; the custom font list supports arrows and Home/End without invoking canvas shortcuts. |
| Dock tabs and Grade, Lens Fx, Text and Effects panels | Existing tab/button/input semantics and visible keyboard focus are preserved by the shared focus rule. |
| Layers | A labelled `tree` with roving `treeitem` focus, selected/expanded/level state; arrows and Home/End navigate, Space toggles visibility, F2 renames, Enter edits flow text, Shift+F10 opens the context menu. |
| Dialogs and reports | `dialog`/`alertdialog` names, initial focus, focus containment, Escape close where safe, and opener restoration use the shared dialog hook. |
| Canvas | The canvas is a visual authoring surface governed by named tools and commands. Layer content remains discoverable through Layers; direct screen-reader spatial editing is not claimed. |
| Status and diagnostics | Existing status/log regions provide textual operation and failure feedback; diagnostic collection remains user-triggered. |

## Focus and display

Keyboard focus uses a two-pixel accent outline with offset and is shown through
`:focus-visible`; pointer clicks do not gain a permanent focus decoration.
Forced-colors mode retains visible active tool, active layer and focus borders.
With `prefers-reduced-motion: reduce`, nonessential animation and transitions
collapse to effectively zero duration. These rules affect presentation only:
they do not invalidate document render state or schedule GPU work.

## Automated release evidence

`npm run smoke:desktop:accessibility:build` packages the production desktop app
and performs a real keyboard-only journey:

1. start page and Open;
2. menubar navigation and Escape restoration;
3. toolbar and tool-family navigation;
4. Layers focus, rename and undo;
5. native save and quick PNG export;
6. visible-control accessible-name scan;
7. reduced-motion and forced-colors capture.

The smoke fails on page errors, missing accessible names, invalid focus, failed
save/export signatures or non-collapsed motion. Generated JSON and screenshots
stay under `tmp/accessibility-smoke/` and are not source artifacts.

## Remaining manual release matrix

Automation does not certify assistive-technology speech or every OS theme. A
release candidate still needs explicit manual evidence for NVDA and JAWS on
Windows, VoiceOver on macOS and the web host, 100/125/150/200 percent display
scales, Windows high-contrast themes, macOS reduced motion, and keyboard use on
an integrated-GPU machine. Record failures as concrete tasks; do not describe
this unexecuted matrix as passing.
