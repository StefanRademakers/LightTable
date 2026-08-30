# Shared UI — first slice: typography

Clean library for the suite, independent of LightTable editor code. The current
LightTable UI is not migrated yet. `apps/ui-demo` is the first real consumer.
Source exports follow the workspace convention; standalone distribution comes later.

```tsx
import '@lighttable/ui/fonts.css'; // once per app; self-hosted Inter 400 and 700
import '@lighttable/ui/styles.css';
import { Text } from '@lighttable/ui';

<main data-ui-theme="dark">
  <Text as="h1" variant="large" weight="bold">Properties</Text>
  <Text as="p">Normal body text</Text>
  <Text variant="small" tone="muted">Supporting information</Text>
</main>
```

## Contract

| Variant | Default size* | Line height* | Intended use |
| --- | --- | --- | --- |
| `small` | 10 px | 14 px | Metadata and compact notes |
| `regular` | 12 px | 18 px | Controls and body text |
| `large` | 14 px | 20 px | Titles and headings |

*Sizes use rem units relative to the browser's default 16 px root. The library
does not fix the document root size; user font scaling and browser zoom remain available.

- Every variant supports `normal` (400) and real `bold` (700).
- `as` supplies semantic HTML, independently of visual size. Headings do not
  silently change weight; choose it explicitly.
- `Text` creates exactly one element; it adds no layout wrappers or margins.
- Apps choose variant, weight and tone. Do not override typography with local
  font-size/weight/family declarations. App CSS may arrange components, not skin them.
- `data-ui-theme="dark"` or `"light"` defines a scoped theme. Nested scopes work.
  Theme changes affect semantic colors, not type metrics. Light is an initial
  reviewable palette, not a migrated LightTable theme.
- Fonts and styles are explicit imports, without React context or global reset.
  Import fonts before the UI stylesheet. No LightTable CSS is required.
- These six styles are the complete initial scale. Add roles centrally when a
  real new control needs one, rather than adding app-local sizes.

Run `npm run dev:ui` to view all six styles, muted text and HTML semantics.
