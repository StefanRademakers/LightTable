# Adjustment layers en LUT-gebruik

Actuele productiestaat na taak 213:

| Adjustment layer | LUT | Grootte |
| --- | --- | ---: |
| Grade | Ja, runtime curve | 16 KB; optionele user Grade Look variabel |
| Lens Fx | Nee | — |
| Color and Vibrance | Ja, lazy compatibility-asset | 1,69 MB binair op disk; circa 22 KB GPU per actieve laag |
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

De adjustment gebruikt een gemeten Photoshop-compatibility-asset van 1.686.678
bytes. Het bestand staat als los `.bin`-asset onder `src/assets/color-vibrance/`
en komt niet in TypeScript, Base64 of de initiale JavaScriptflow terecht. Het
wordt pas opgehaald wanneer een Color and Vibrance-laag bestaat.

- Temperature/Tint: een gekoppeld 21 × 21 slideroppervlak met per positie een
  compacte 9³ RGB-volume en expliciete tijdelijke headroom;
- gecombineerde Temperature/Tint plus Vibrance/Saturation: een tweede 17³
  kleurvolume over zeven signed sliderknopen per as;
- geïsoleerde Vibrance/Saturation: de bestaande analytische OKLab-route met
  huidachtige en gamutbescherming blijft behouden;
- zolang het asset nog laadt: de analytische CAT16-route is alleen fallback,
  niet langer bewijs van Photoshop-gelijkheid.

De vroegere 8,59 MB gegenereerde TypeScript met 490 meetvolumes is verwijderd.
Dat getal is alleen een historische baseline, geen actuele asset of runtimekost.
De actuele webdelivery-audit blijft groen op 2,98 MB initiale JavaScript en
302,2 KB CSS. Het compatibility-bestand wordt als afzonderlijk lazy asset
gebouwd. Ten opzichte van de vroegere 6.136.221 bytes binaire modeldata is het
72,5% kleiner; de 8,59 MB gegenereerde TypeScript/Base64-bron blijft verwijderd.

Niet iedere LUT is problematisch. De relevante vragen zijn of de data nodig is,
wanneer ze geladen wordt, hoe groot de runtimekopie is, of sliderupdates uploads
veroorzaken en of de visuele winst opweegt tegen die kosten. Runtimecurves en
door gebruikers gekozen Color Lookup-bestanden hebben daarom een ander
productprofiel dan de verwijderde calibratiebibliotheek.
