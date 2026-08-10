# Lighttable Healing Brush — High Level Implementation Plan

## Doel

Implementeer een Photoshop-achtige **Healing Brush** in Lighttable die **100% GPU-based** werkt en zoveel mogelijk gebruikmaakt van de bestaande brush- en Clone Stamp-infrastructuur.

De tool moet eerst de bestaande brush engine, beschikbare brush types en eventuele Clone Stamp/source-sampling architectuur onderzoeken voordat nieuwe systemen worden toegevoegd.

Het uitgangspunt:

> **Healing Brush is in essentie een sampled brush zoals Clone Stamp, maar past het gesamplede detail aan de kleur, luminantie en shading van de destination aan.**

---

## 1. Bestaande brush architectuur onderzoeken

Analyseer eerst:

- Hoe normale brush strokes en dabs worden opgebouwd.
- Welke onderdelen volledig op de GPU draaien.
- Hoe size, hardness, opacity, flow, spacing en pressure zijn geïmplementeerd.
- Hoe brush masks en brush tips worden gegenereerd.
- Hoe layers als paint target worden behandeld.
- Hoe undo/redo en stroke snapshots werken.
- Welke infrastructuur al bestaat voor Clone Stamp of andere sampled brushes.

Voorkom een aparte Healing Brush-engine wanneer bestaande componenten herbruikbaar zijn.

---

## 2. Gedeelde Sampled Brush infrastructuur

Clone Stamp en Healing Brush zouden zoveel mogelijk dezelfde source-sampling infrastructuur moeten gebruiken.

```text
                 Brush Engine
                      │
              Sampled Brush Core
                      │
          ┌───────────┴───────────┐
          │                       │
     Clone Stamp             Healing Brush
          │                       │
   Direct sampling          Adaptive healing
```

De gedeelde infrastructuur beheert onder andere:

- Source point.
- Destination point.
- Source/destination offset.
- Stroke lifecycle.
- Aligned / non-aligned gedrag.
- Source texture/snapshot.
- Layer sampling mode.
- Brush mask en bestaande brush dynamics.

---

## 3. Source selectie

Gebruik dezelfde interactie als Clone Stamp:

```text
Alt / Option + Click
```

Hiermee wordt het source point ingesteld.

Bij het starten van een stroke wordt de relatie tussen source en destination vastgelegd. Tijdens het schilderen beweegt de sampling position mee met de brush volgens deze offset.

Ondersteun hetzelfde **Aligned** gedrag als Clone Stamp.

---

## 4. Healing principe

Clone Stamp kopieert source pixels rechtstreeks.

```text
Source Pixels
     +
Brush Mask
     ↓
Destination
```

Healing Brush gebruikt de source voornamelijk voor **detail/texture**, terwijl de uiteindelijke pixels moeten aansluiten op de lokale eigenschappen van de destination.

```text
Source Detail
      +
Destination Color / Luminance / Shading
      ↓
GPU Healing Operation
      +
Brush Mask
      ↓
Destination
```

Het doel is niet om een specifieke Photoshop-formule te kopiëren, maar om hetzelfde gebruikersgedrag te bereiken.

---

## 5. GPU Healing Pipeline

Onderzoek een GPU-vriendelijke aanpak waarbij source en destination worden opgesplitst in bijvoorbeeld:

- Low-frequency kleur/luminantie.
- High-frequency detail/texture.

Gebruik het relevante detail uit de source en combineer dit met de lokale appearance van de destination.

De exacte methode moet worden gekozen op basis van:

- Visuele kwaliteit.
- Stabiliteit bij verschillende brush sizes.
- Performance.
- WebGPU suitability.
- Mogelijkheid om tijdens een stroke interactief te blijven werken.

Alle image processing moet op de GPU blijven.

---

## 6. Brush Engine hergebruik

Healing Brush moet dezelfde brush properties gebruiken als normale brushes waar dat logisch is:

- Size
- Hardness
- Opacity
- Flow
- Spacing
- Pressure
- Brush tip / shape

Voeg geen aparte implementaties hiervan toe tenzij technisch noodzakelijk.

De Healing Brush moet vooral een andere **pixel source / processing stage** zijn binnen dezelfde paint pipeline.

---

## 7. Sampling van layers

Ondersteun dezelfde sampling concepten als Clone Stamp:

- Current Layer
- Current & Below
- All Layers

Hierdoor moet non-destructive healing mogelijk zijn op een lege layer boven het originele beeld.

De bestaande compositor moet waar mogelijk gebruikt worden om de benodigde sampled source representation te leveren.

---

## 8. Stroke snapshot / feedback voorkomen

Voorkom dat pixels die tijdens dezelfde stroke worden geschreven onmiddellijk opnieuw als source worden gebruikt wanneer dit ongewenste feedback veroorzaakt.

Onderzoek hoe de bestaande brush engine hiermee omgaat en gebruik bij voorkeur dezelfde snapshot- of temporary texture-strategie.

De GPU pipeline moet een stabiele source/destination state hebben gedurende de stroke.

---

## 9. Preview en cursor

Hergebruik waar mogelijk dezelfde source indicator en cursor UX als Clone Stamp.

Minimaal:

- Brush outline.
- Source marker.
- Duidelijke relatie tussen source en destination.

Als Clone Stamp een source overlay/preview krijgt, ontwerp deze infrastructuur zodat Healing Brush deze eveneens kan gebruiken.

---

## 10. Architectuurdoel

Voorkom losse implementaties voor iedere paint tool.

Streef naar:

```text
Brush Engine
    │
    ├── Color Brush
    ├── Eraser
    ├── Sampled Brush Core
    │       ├── Clone Stamp
    │       └── Healing Brush
    │
    └── toekomstige brush-based tools
```

Brush mechanics, source sampling en image processing moeten zoveel mogelijk afzonderlijke verantwoordelijkheden blijven.

---

## Eerste implementatiefase

Begin met een minimale maar hoogwaardige Healing Brush:

1. Analyseer bestaande brush- en Clone Stamp-infrastructuur.
2. Maak/hergebruik een gedeelde Sampled Brush Core.
3. Implementeer source/destination tracking.
4. Implementeer een eerste volledig GPU-based healing operation.
5. Integreer bestaande brush dynamics.
6. Ondersteun layer sampling en non-destructive painting.
7. Test verschillende textures, gradients, edges en brush sizes.
8. Optimaliseer daarna de healingkwaliteit en GPU pipeline.

Prioriteit is een **eenvoudige, gedeelde architectuur en realtime GPU performance**, niet het direct toevoegen van veel gespecialiseerde healing-modi.
