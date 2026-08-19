# Adjustment layers en LUT-gebruik

| Adjustment layer | LUT | Grootte |
| --- | --- | ---: |
| Grade | Ja, runtime curve | 16 KB; optionele user Grade Look variabel |
| Lens Fx | Nee | - |
| Color and Vibrance | Ja, embedded | **8,59 MB TypeScript / 6,14 MB binair** |
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

## Waar de grote Color-and-Vibrance-data leeft

- Bronbestand: `packages/lighttable-app/src/lighttable/gpu/photoshopColorVibranceLut.generated.ts`.
- In dat bestand: 8.591.289 bytes Base64-TypeScript rond 6.136.221 bytes LUT-data.
- In de web- en Electronbuild: statisch onderdeel van de initiale renderer-JavaScriptchunk.
- Gecomprimeerd: circa 3,64 MB Brotli van de totale 4,30 MB initiale JavaScriptlast.
- Na module-evaluatie: de Base64-strings bestaan al, ook zonder gebruikte Color-and-Vibrance-laag.
- Bij eerste werkelijk gebruikte Color-and-Vibrance-laag: 5.813.262 bytes white-balancedata en
  322.959 bytes kleurdata worden gedecodeerd en modulebreed gecachet.
- Per actieve laag: twee afgeleide 13x13x13 GPU-textures, samen circa 43,9 KB.

De 8,59 MB is dus geen GPU-LUT van 8,59 MB. Het is een ingebouwde bibliotheek van 490
LUTs die als JavaScriptbron wordt verscheept. De actieve GPU-data is klein; de vaste
download-, parse- en JS-geheugenkosten zijn het aandachtspunt.

## Is 8,59 MB groot?

Ja, voor initiale JavaScript is dit groot. Een WebP van 3 MB is eveneens een aanzienlijke
download, maar blijft een apart binair beeldasset dat de JavaScript-engine niet als
tienduizenden strings hoeft te parsen en samen te voegen. Hier vormt één calibration-
dataset circa 77% van de ruwe initiale JavaScript en circa 85% van de Brotli-grootte.

Dat maakt dit een terecht onderzoekspunt. De eerste vraag blijft echter of de 490 LUTs
inhoudelijk nodig zijn; alleen verplaatsen naar een binair bestand lost de modelomvang
niet op.
