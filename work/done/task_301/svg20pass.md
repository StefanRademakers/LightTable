# SVG First Pass

## Advies

LightTable heeft al een native, editable vector-engine. Daarom is het verstandig om SVG **niet** als tweede vector-engine of browser-gedreven documentmodel binnen te halen.

De beste richting is:

- SVG behandelen als **import/export-formaat** rond het bestaande LightTable vector-model.
- De eigen canonical vector representation leidend houden.
- Geen SVG DOM, Canvas 2D scene of externe vector scene graph als tweede document authority introduceren.
- Import en export vanaf het begin als één gezamenlijke codec-laag ontwerpen.

## Aanbevolen architectuur

```text
SVG string
    ↓
safe XML parser
    ↓
LightTable SVG AST / import context
    ↓
SVG semantics
    ├─ inherited styles
    ├─ transforms
    ├─ viewBox
    ├─ gradients
    ├─ primitives
    └─ path commands
    ↓
Canonical LightTable Vector Model
    ↓
WebGPU renderer
```

Export gaat in de andere richting:

```text
Canonical LightTable Vector Model
    ↓
SVG serializer
    ↓
SVG string
```

SVG blijft daarmee puur een I/O-formaat. De LightTable documentstructuur, curves, gradients, transforms en styling blijven de echte brondata.

## Wat zelf bouwen

Het grootste deel kan het beste LightTable-native worden gebouwd.

### Zelf implementeren

- SVG import planner
- SVG export serializer
- SVG path-data parser
- `viewBox` en placement logic
- affine transforms
- inherited presentation attributes
- bounded inline `style` support
- primitives:
  - `rect`
  - `circle`
  - `ellipse`
  - `line`
  - `polyline`
  - `polygon`
- `<path>` commands:
  - `M`
  - `L`
  - `H`
  - `V`
  - `C`
  - `S`
  - `Q`
  - `T`
  - `A`
  - `Z`
- quadratic-to-cubic conversion
- elliptical-arc-to-cubic conversion
- SVG color parsing en sRGB → LightTable linear conversion
- fill/stroke mapping
- fill rules
- gradients
- `<defs>` resolution
- bounded `<use>` expansion
- import warnings / conversion report
- SVG serialization

Dit zijn allemaal redelijk afgebakende onderdelen en geven volledige controle over de mapping naar het native LightTable model.

## Wat niet zelf hoeft

### XML parser

Gebruik bij voorkeur een kleine, bewezen XML parser in plaats van zelf XML te implementeren.

De parser moet minimaal geschikt zijn voor een veilige SVG-import pipeline met:

- geen DTD verwerking;
- geen external entities;
- geen netwerkverzoeken;
- bounded input;
- scripts en event handlers afwijzen;
- `foreignObject` afwijzen.

Een kleine dependency hiervoor is prima. De SVG-semantiek zelf moet daarentegen LightTable-code blijven.

## Boolean geometry

Path boolean operations zijn een uitzondering waar een bewezen externe implementation veel waarde kan hebben.

Denk aan:

- union;
- subtract / difference;
- intersect;
- exclude / xor.

Dit lijkt relatief simpel, maar robuuste cubic-Bezier booleans bevatten veel lastige gevallen:

- curve intersections;
- tangencies;
- overlapping edges;
- winding;
- degenerate geometry;
- numerical tolerances.

Daarvoor kan bijvoorbeeld een geïsoleerde adapter rond **Skia PathOps / PathKit** interessant zijn.

Belangrijk:

```text
LightTable native path
    ↓
PathOps adapter
    ↓
boolean operation
    ↓
LightTable native path
```

PathKit wordt dan alleen een geometry solver en **niet** de vector-engine of document authority.

## Paper.js

Paper.js kan nuttig zijn als referentie:

- SVG import/export gedrag bekijken;
- edge cases onderzoeken;
- tests en mappingstrategie bestuderen.

Maar Paper.js zou niet in de LightTable production pipeline moeten komen.

Niet:

```text
LightTable
    ↓
Paper.js scene graph
    ↓
SVG
```

Dat introduceert opnieuw een tweede scene graph met eigen:

- paths;
- styling;
- transforms;
- hierarchy;
- semantics.

De LightTable canonical model moet rechtstreeks SVG kunnen lezen en schrijven.

## Package voorstel

```text
packages/
  vector-core/

  vector-svg/
    parser/
      xml.ts
      numbers.ts
      path-data.ts
      transform.ts
      color.ts

    import/
      import-svg.ts
      style-context.ts
      gradients.ts
      primitives.ts
      use.ts

    export/
      export-svg.ts
      path-writer.ts
      gradient-writer.ts
      xml-writer.ts

    geometry/
      arc-to-cubic.ts
      quadratic-to-cubic.ts

    tests/
      svg-fixtures/
```

`vector-svg` kent het SVG-formaat.

`vector-core` hoeft niets van SVG te weten.

Hierdoor blijft de dependency richting schoon:

```text
vector-svg
    ↓
vector-core
```

en nooit:

```text
vector-core
    ↓
vector-svg
```

## Import en export tegelijk ontwerpen

Hoewel SVG import als eerste feature gebouwd kan worden, moet de interne mapping meteen ook vanuit exportperspectief worden ontworpen.

Bijvoorbeeld:

| LightTable | SVG |
| --- | --- |
| live rectangle | `<rect>` |
| live ellipse | `<ellipse>` |
| open path | `<path>` |
| compound path | `<path>` + fill rule |
| solid fill | `fill` |
| stroke | `stroke` properties |
| linear gradient | `<linearGradient>` |
| radial gradient | `<radialGradient>` |
| affine transform | `transform` |
| multiple elements | sibling SVG elements |

Als native semantics niet exact naar SVG kunnen worden vertaald, moet export dezelfde filosofie gebruiken als import:

1. exact representeren;
2. gecontroleerd converteren;
3. expliciete waarschuwing geven;
4. eventueel appearance fallback gebruiken.

Nooit stilletjes betekenis verliezen.

## Roundtrip tests

Vanaf het begin roundtrip-tests toevoegen:

```text
SVG A
 ↓ import
Native model A
 ↓ export
SVG B
 ↓ import
Native model B

Native model A ≈ Native model B
```

Tekstuele gelijkheid van SVG A en SVG B is niet nodig.

De **semantiek en rendering** moeten equivalent zijn.

Daarnaast rendering regression tests:

```text
reference SVG render
        ≈
LightTable native render
```

Test hiervoor onder andere:

- paths;
- arcs;
- quadratic curves;
- transforms;
- nested transforms;
- holes;
- evenodd/nonzero;
- stroke joins;
- caps;
- dash patterns;
- gradients;
- opacity;
- `<use>`;
- malformed SVG;
- cyclic references;
- extreme nesting;
- invalid coordinates.

## Eerste implementatieslice

De eerste bruikbare versie hoeft niet de volledige SVG-specificatie te ondersteunen.

### Pass 1

Ondersteun:

- `<svg>`
- `viewBox`
- `<g>` door transforms/styles te flattenen
- `<path>`
- `<rect>`
- `<circle>`
- `<ellipse>`
- `<line>`
- `<polyline>`
- `<polygon>`
- transforms
- solid fills
- fill opacity
- fill rules
- strokes
- stroke caps/joins/dashes
- element opacity

### Pass 2

Voeg toe:

- linear gradients;
- radial gradients;
- gradient transforms;
- inherited presentation attributes;
- `<defs>`;
- `<use>`;
- betere conversion reporting.

### Later

Pas toevoegen wanneer het native LightTable-model er echt ondersteuning voor heeft:

- editable group hierarchy;
- clipping;
- masks;
- boolean authoring;
- text;
- embedded raster images;
- patterns;
- markers;
- advanced SVG filters;
- volledige CSS cascade.

## MCP / Actions boundary

SVG-import moet één high-level operation zijn:

```json
{
  "command": "vector.importSvg",
  "parameters": {
    "svg": "<svg>...</svg>",
    "placement": "document",
    "layerName": "Imported SVG"
  }
}
```

De importer:

1. parseert de volledige SVG;
2. valideert alle limieten en references;
3. maakt een import plan;
4. geeft warnings/conversions terug;
5. commit daarna één atomic document mutation.

Niet duizenden `vector.create` calls uitvoeren via MCP.

File > Open, Place, clipboard paste, Actions en MCP moeten uiteindelijk allemaal dezelfde importer gebruiken.

## Samenvatting

De aanbevolen strategie is ongeveer:

**90% LightTable-native bouwen.**

Gebruik externe code alleen waar die duidelijk waarde toevoegt:

- een kleine veilige XML parser;
- eventueel Skia PathOps / PathKit voor complexe boolean geometry.

Gebruik bestaande vectorlibraries zoals Paper.js vooral als referentie en testbron, niet als tussenliggende runtime-engine.

De belangrijkste architectuurregel blijft:

> SVG is een codec rond het LightTable vector-model, niet een tweede vector-engine.

Dat maakt de eerste importer overzichtelijk, houdt het documentmodel schoon en maakt een latere hoogwaardige SVG-export veel eenvoudiger.
