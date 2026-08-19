# Adjustment layers en LUT-gebruik

Actuele productiestaat na taak 211:

| Adjustment layer | LUT | Grootte |
| --- | --- | ---: |
| Grade | Ja, runtime curve | 16 KB; optionele user Grade Look variabel |
| Lens Fx | Nee | — |
| Color and Vibrance | Nee | Geen embedded data; analytische CAT16/OKLab-shader |
| Brightness / Contrast | Ja, embedded 1D | 4,18 KB TypeScript / 975 bytes meetdata |
| Levels | Nee | — |
| Curves | Ja, runtime | 16 KB per curve-texture |
| Exposure | Nee | — |
| Vibrance (legacy, verborgen) | Nee | — |
| Hue / Saturation | Nee | — |
| Color Balance | Ja, embedded 2D | 74,3 KB TypeScript / 52,7 KB binair |
| Black & White | Nee | — |
| Photo Filter | Nee | — |
| Channel Mixer | Nee | — |
| Color Lookup | Ja, userbestand | Variabel; maximaal 4,39 MB GPU bij 65³ RGBA32F |
| Selective Color | Nee | — |
| Invert | Nee | — |
| Posterize | Nee | — |
| Threshold | Nee | — |
| Gradient Map | Nee | Maximaal acht stops in uniforms |
| Clarity and Dehaze | Nee | — |
| Grain | Nee | — |

## Color and Vibrance

De huidige adjustment gebruikt geen LUT, Base64-modeldata, eigen 3D-textures of
slider-time texture-upload. De vier sliderwaarden reizen mee in de bestaande
adjustment-uniform. Het gedrag leeft in `gpu/shaders.ts`; de gedeelde parameters
en CPU-referentie staan in `gpu/colorVibranceModel.ts`.

- Temperature/Tint: gekoppelde CAT16-white-pointadaptatie;
- Vibrance/Saturation: OKLab-chromarespons;
- Vibrancebescherming: lage verzadiging plus zacht OKLCH hue × chroma ×
  lightness-masker;
- gamut: continue projectie vanaf de neutrale as.

De vroegere 8,59 MB gegenereerde TypeScript met 490 meetvolumes is verwijderd.
Dat getal is alleen een historische baseline, geen actuele asset of runtimekost.
De huidige hoofdchunk is 2.848.006 bytes; de volledige initiale JavaScriptflow
is 2.975.571 bytes volgens de webdelivery-audit.

Niet iedere LUT is problematisch. De relevante vragen zijn of de data nodig is,
wanneer ze geladen wordt, hoe groot de runtimekopie is, of sliderupdates uploads
veroorzaken en of de visuele winst opweegt tegen die kosten. Runtimecurves en
door gebruikers gekozen Color Lookup-bestanden hebben daarom een ander
productprofiel dan de verwijderde calibratiebibliotheek.
