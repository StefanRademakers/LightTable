# Adjustment layers en LUT-gebruik

| Adjustment layer | LUT | Grootte |
| --- | --- | ---: |
| Grade | Ja, runtime curve | 16 KB; optionele user Grade Look variabel |
| Lens Fx | Nee | - |
| Color and Vibrance | Nee | Analytische CAT16/OKLab-shader; geen embedded data |
| Brightness / Contrast | Ja, embedded 1D | 4,18 KB TypeScript / 975 bytes meetdata |
| Levels | Nee | - |
| Curves | Ja, runtime | 16 KB per curve-texture |
| Exposure | Nee | - |
| Vibrance (legacy, verborgen) | Nee | - |
| Hue / Saturation | Nee | - |
| Color Balance | Ja, embedded 2D | 74,3 KB TypeScript / 52,7 KB binair |
| Black & White | Nee | - |
| Photo Filter | Nee | - |
| Channel Mixer | Nee | - |
| Color Lookup | Ja, userbestand | Variabel; maximaal 4,39 MB GPU bij 65x65x65 RGBA32F |
| Selective Color | Nee | - |
| Invert | Nee | - |
| Posterize | Nee | - |
| Threshold | Nee | - |
| Gradient Map | Nee | Maximaal 8 stops in uniforms |
| Clarity and Dehaze | Nee | - |
| Grain | Nee | - |

## Waar de eerdere grote Color-and-Vibrance-data leefde

De eerdere 8,59 MB was geen enkele GPU-LUT maar een ingebouwde bibliotheek van
490 volledige 13x13x13-volumes: 441 voor Temperature/Tint en 49 voor
Vibrance/Saturation. Die bibliotheek, de Base64-decodering, twee GPU-textures per
actieve laag en slider-time uploads zijn in taak 211 volledig verwijderd.

De actuele implementatie leeft als uitlegbare shaderwiskunde in `shaders.ts` en
als geteste parameter-/CPU-referentie in `colorVibranceModel.ts`:

- Temperature/Tint: gekoppelde CAT16-white-pointadaptatie;
- Vibrance/Saturation: OKLab-chromarespons;
- bescherming: lage-verzadigingsrespons plus zacht hue x chroma x lightness-masker;
- gamut: continue projectie vanaf de neutrale as met dezelfde OKLab-lightness.

## Was 8,59 MB groot?

Ja, voor initiale JavaScript was dit groot. Een WebP van 3 MB is eveneens een
aanzienlijke download, maar blijft een apart binair beeldasset dat de JavaScript-
engine niet als tienduizenden strings hoeft te parsen en samen te voegen. De oude
calibratiedataset vormde circa 77% van de ruwe initiale JavaScript en circa 85%
van de Brotli-grootte.

Dat onderzoekspunt is gesloten: alle 8.591.289 bytes gegenereerde TypeScript en
6.136.221 bytes modeldata zijn weg. De definitieve productiebouw meet 2,848 MB
minified / 0,760 MB gzip / 0,594 MB Brotli voor de hoofdchunk, tegenover 11,09 /
4,80 MB in de auditbaseline. Er is voor deze adjustment geen featureasset meer
om lazy te laden.
