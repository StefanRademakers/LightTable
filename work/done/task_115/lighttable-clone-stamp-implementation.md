# Lighttable Clone Stamp — High Level Implementation Plan

## Doel

Implementeer een Photoshop-achtige **Clone Stamp Tool** in Lighttable die volledig **GPU-based** werkt en zoveel mogelijk hergebruik maakt van de bestaande brush architectuur.

De implementatie moet eerst de huidige brush engine en bestaande brush types analyseren voordat nieuwe infrastructuur wordt toegevoegd. Er zijn al meerdere brushes aanwezig; bepaal expliciet waar functionaliteit overlapt en voorkom dubbele systemen.

Het uitgangspunt:

> **Clone Stamp is geen aparte brush engine, maar een bestaande brush waarbij de pixel-input uit een andere locatie in het document komt.**

## 1. Bestaande brush architectuur onderzoeken

Analyseer eerst:

- Hoe strokes en brush dabs momenteel worden opgebouwd.
- Welke delen volledig op de GPU draaien.
- Hoe brush tips / masks worden gegenereerd.
- Hoe size, hardness, opacity, flow, spacing en pressure worden verwerkt.
- Welke verschillende brush types/modes al bestaan en wat zij delen.
- Hoe een brush zijn paint/input data aanlevert.
- Hoe layer targets en masks worden behandeld.
- Hoe strokes worden committed.
- Hoe undo/redo voor brushes werkt.

Bepaal daarna welke onderdelen direct door Clone Stamp gebruikt kunnen worden.

## 2. Clone Stamp als brush/input mode

Voeg Clone Stamp bij voorkeur toe als een nieuwe **paint source / brush input mode** binnen de bestaande brush pipeline.

Normale brush:

```text
Brush Mask
    +
Brush Color
    ↓
GPU Composite
```

Clone Stamp:

```text
Brush Mask
    +
Sampled Source Texture
    ↓
GPU Composite
```

Size, hardness, opacity, flow, spacing, pressure en brush tip gedrag moeten dus zoveel mogelijk exact dezelfde infrastructuur gebruiken als normale brushes.

## 3. Clone Source

Ondersteun een expliciete clone source.

Basis UX:

```text
Alt / Option + Click → Set Clone Source
```

Bij het starten van een stroke wordt de relatie tussen de source position en destination position vastgelegd.

Tijdens het schilderen beweegt de sampling location mee met de brush volgens deze offset.

Conceptueel:

```text
Source Position + Brush Movement → Sample Position
Destination Position            → Paint Position
```

Alle sampling en compositing blijft GPU-based.

## 4. Aligned gedrag

Ondersteun minimaal twee modes.

### Aligned ON

De relatie tussen source en destination blijft behouden wanneer een stroke wordt losgelaten en een nieuwe stroke wordt gestart.

### Aligned OFF

Iedere nieuwe stroke begint opnieuw vanaf de oorspronkelijk ingestelde clone source.

Houd deze state buiten de algemene brush engine waar mogelijk; de brush engine hoeft alleen de actuele source transform / coordinates te ontvangen.

## 5. GPU Source Sampling

De Clone Stamp moet rechtstreeks vanuit een GPU texture samplen.

Vermijd:

- CPU pixel copies
- CPU image buffers tijdens strokes
- GPU → CPU → GPU roundtrips

De bestaande GPU brush pipeline moet idealiter alleen een andere input source krijgen.

Onderzoek hierbij hoe feedbackproblemen voorkomen moeten worden wanneer source en destination zich op dezelfde layer bevinden.

Een stroke moet een stabiele bron kunnen gebruiken zonder dat nieuw geschilderde pixels onbedoeld direct de source van dezelfde stroke veranderen.

## 6. Layer Sampling

Ontwerp de source abstraction zodat later minimaal deze modes mogelijk zijn:

- Current Layer
- Current & Below
- All Layers / Visible Composite

Gebruik waar mogelijk bestaande compositor textures of render targets in plaats van speciaal voor Clone Stamp opnieuw layers samen te stellen.

De architectuur moet ook non-destructive cloning naar een lege layer ondersteunen.

## 7. Brush Preview / Clone Overlay

Onderzoek of de bestaande brush cursor/preview infrastructuur hergebruikt kan worden.

De Clone Stamp moet uiteindelijk een GPU preview van de source onder de brush kunnen tonen zodat de gebruiker de clone visueel kan uitlijnen voordat hij schildert.

Dit moet dezelfde source mapping gebruiken als de daadwerkelijke stroke zodat preview en resultaat exact overeenkomen.

## 8. Clone Source Transform

Ontwerp de source mapping vanaf het begin als een transform in plaats van alleen een simpele XY-offset.

Hierdoor kunnen later zonder architectuurwijziging functies worden toegevoegd zoals:

- Offset
- Rotation
- Scale
- Flip Horizontal
- Flip Vertical
- Meerdere opgeslagen clone sources

Voor de eerste implementatie hoeft alleen translation/source offset actief te zijn.

## 9. Undo / Redo

Clone Stamp strokes moeten dezelfde undo/redo infrastructuur gebruiken als normale brush strokes.

Een clone stroke moet vanuit documentperspectief gewoon een paint operation zijn.

Voorkom een aparte Clone Stamp history implementation tenzij de bestaande architectuur dit absoluut noodzakelijk maakt.

## 10. Architectuurprincipe

Probeer de brush pipeline uiteindelijk conceptueel richting dit model te brengen:

```text
Brush Engine
    │
    ├── Brush Geometry / Dabs
    ├── Brush Tip / Mask
    ├── Pressure / Flow / Opacity
    │
    └── Paint Source
          │
          ├── Solid Color
          ├── Existing Brush Sources
          └── Clone Source Texture
                    │
                    ↓
              GPU Composite
                    ↓
                Target Layer
```

Clone Stamp moet vooral een nieuwe **Paint Source** zijn, niet een duplicatie van de brush stack.

## Implementatievolgorde

1. Analyseer huidige brush engine en alle bestaande brush implementations.
2. Identificeer gedeelde brush infrastructuur en mogelijke overlap.
3. Bepaal of een generieke `PaintSource` / vergelijkbare abstraction nuttig is binnen de huidige architectuur.
4. Implementeer clone source selection met Alt/Option + Click.
5. Implementeer GPU texture sampling met source/destination offset.
6. Integreer dit met bestaande brush size/hardness/flow/opacity/spacing/pressure.
7. Implementeer Aligned ON/OFF.
8. Zorg voor stabiele source sampling tijdens een stroke.
9. Integreer layer/composite sampling.
10. Voeg GPU clone overlay/preview toe.
11. Integreer volledig met bestaande undo/redo en document state.
12. Controleer performance en voorkom CPU/GPU roundtrips.

## Belangrijkste randvoorwaarden

- **100% GPU-based tijdens painting.**
- Hergebruik bestaande brush engine maximaal.
- Geen tweede brush systeem bouwen voor Clone Stamp.
- Geen CPU pixel processing in de interactieve paint path.
- Preview en daadwerkelijke clone sampling moeten dezelfde mapping gebruiken.
- Architectuur voorbereiden op transformed en multiple clone sources zonder deze direct volledig te hoeven implementeren.
- Gedrag moet uiteindelijk aansluiten bij de bekende Photoshop Clone Stamp UX.
