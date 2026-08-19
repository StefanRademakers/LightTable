# LightTable app-audit — 19 augustus 2026

> **Status:** niet-canonieke, onafhankelijke momentopname. Dit document staat bewust buiten `architecture/`. Het beschrijft wat tijdens deze audit aantoonbaar was, wat sterk wordt vermoed en wat nog door runtime- of gebruikersonderzoek bewezen moet worden.

## Her-audit na de eerste verbeterslag

> **Actuele bewijsstand:** commit `713a09e1` voor de Color/Vibrance-verbeterslag,
> nog steeds op een door ander actief werk vuile checkout. Waar deze sectie een
> oorspronkelijke bevinding tegenspreekt, is deze sectie leidend. De oude tekst
> blijft staan zodat zichtbaar is welk risico werkelijk is gesloten en welk
> risico alleen beter is gemeten.

De eerste verbeterslag heeft zes concrete problemen gesloten zonder de editor-
of documentsemantiek te herschrijven:

| Oorspronkelijke bevinding | Nieuwe staat | Bewijs |
| --- | --- | --- |
| R3, abort-listeners blijven na normale polls hangen | **Opgelost** | Een gedeelde delay ruimt timer en listener af bij resolve en abort; 250 normale rondes en cancelpaden zijn getest. |
| R4, drie drijvende commandolijsten | **Opgelost voor de actuele exposure** | Een machineleesbare commandocatalogus genereert runtimeprofielen en types; desktop en externe MCP valideren dezelfde profielen en contracttests bewaken subsetrelaties. |
| Agent Access kan een door Fetch verboden ephemeral port publiceren | **Opgelost** | Automatische poortkeuze weigert zulke poorten, sluit de listener en probeert begrensd opnieuw; drie volledige desktoptestruns waren groen. |
| R6, direct bereikbare `ws`-advisories | **Opgelost** | Beide tunnelconsumenten vereisen en gebruiken `ws@8.21.3`; reconnect-, auth-, hostile-message- en shutdowntests zijn groen. |
| R1/R11, bron- en architectuur-audits werken niet als actuele gate | **Opgelost als meet- en driftgate** | Gegenereerde bron is apart accountable, 18 handgeschreven hotspots hebben ownership-/productrisicoreviews, docs worden tegen de workspace geverifieerd en allebei de gates zijn groen. Grote coordinatieknooppunten zijn daarmee gemeten, niet automatisch gezond verklaard. |
| R10, `src/ui` importeert editorbusinesslogica | **Opgelost** | De anchor-picker bezit nu zijn eigen structurele waardencontract. UI-boundary en de actuele usage-inventory zijn groen zonder globale budgetverruiming. |

### Wat de her-audit nu bewijst

- Workspace-typecheck, alle workspace-tests, de webproductiebouw, de desktop-
  packagebouw, distributiegrens en alle vier structurele audits slagen.
- De productie-dependencyaudit ging van drie naar **twee high findings**: alleen
  `@huggingface/transformers` en `sharp`, beide zonder beschikbare npm-fix.
  Een verse Windows-package bevat **nul** `sharp`, `@img/sharp` of native
  libvips-packageentries. Transformers draait in drie losse, lazy rendererworkers.
  Dat verlaagt de bewezen shipped reachability sterk, maar de installgraph blijft
  bewust rood totdat upstream of een andere dependencykeuze het oplost.
- Het webdeliverybudget is reproduceerbaar en flow-aware. Zware ML-, vision-,
  PSD-, PDF- en text-assets zijn aantoonbaar lazy. Taak 211 heeft bovendien de
  volledige Color/Vibrance-calibratiebibliotheek uit de initiale editorchunk
  verwijderd; de definitieve nieuwe buildmeting staat bij R5.
- De 68.191-regelige Color/Vibrance-LUT was verklaarbare gegenereerde bron, maar
  nog steeds een verkeerde productarchitectuur. De eerste CAT16-vervanging bleek
  bij Temperature/Tint-extremen zichtbaar onjuist. Taak 213 vervangt die claim
  door een complete vier-sliderreferentie en een los lazy compatibility-asset;
  geïsoleerde Vibrance/Saturation behoudt de compacte analytische route.
- De commandocatalogus legt expliciet vast dat **alle gebruikersfunctionaliteit
  uiteindelijk agentbereikbaar** moet worden. De huidige Agent Access- en externe
  MCP-profielen zijn een gecontroleerde tussenstand. Ontbrekende Face Warp- en
  andere commando's zijn rolloutwerk, geen permanent ontwerpdoel.

### Wat ik bewust niet heb "opgelost" met cosmetische refactors

- `LightTableEditorOverlay`, `WebGpuEngine` en desktop `main.ts` blijven grote
  coordinatieknooppunten. De structurele audit beoordeelt nu samenhang,
  lifecycle-eigenaarschap, fan-out en productblast-radius in plaats van alleen
  regelaantallen. Extractie is pas winst als een capability daarna zelfstandig
  testbaar en owned is; bestandssplitsing zonder zo'n grens is geen vooruitgang.
- Color/Vibrance gebruikt opnieuw gemeten data, maar nu begrensd en lazy: 1,69
  MB los binair in plaats van 8,59 MB gegenereerde TypeScript / 6,14 MB data in
  de initiale bundle. Photoshop-gelijkheid wordt per slider en combinatie
  gerapporteerd; één samengevouwen paritypercentage is geen bewijs meer.
- Een echte twee-/twaalfuurs soak, integrated-GPU-/Apple-Siliconkwalificatie en
  representatieve gebruikerstests zijn niet vervangen door meer unit tests.
- Grade/Camera Raw, PSD-editability en taak 201 blijven actieve producttrajecten.
  Hun lokale wijzigingen zijn niet door deze audit overgenomen of gecommit.

### Commits van deze verbeterslag

- `f7c4a602` - AI-pollinglisteners lifecycle-safe gemaakt.
- `7d59c0dc` - canonieke, gegenereerde commandoprofielen ingevoerd.
- `ac964f65` - onbruikbare automatische Agent Access-poorten voorkomen.
- `bdaba9b1` - ownership- en webdeliveryrisico meetbaar gemaakt.
- `6d031e52` - WebSocket-runtime naar de gepatchte lijn gebracht.
- `b14a6869` - UI primitive-boundary en inventorygate hersteld.
- `713a09e1` - brute-force Color/Vibrance-LUT vervangen door een compact,
  verklaarbaar en op extremen getest kleurmodel.

Mijn actuele conclusie is daardoor scherper dan de oorspronkelijke: de meest
direct bereikbare lifecycle-, contract- en netwerkbreuken zijn gesloten en de
kwaliteitsgates functioneren weer. Het resterende werk zit vooral in aantoonbare
productkosten en releasebewijs: bootstrapgewicht, grote coordinatieblast-radii,
hardware/soaks, interchangepariteit en de breedte van agentexposure.

## 1. Samenvatting in gewone mensentaal

LightTable is geen prototype en ook geen verzameling losse Photoshop-knoppen. De app heeft een serieus, grotendeels coherent fundament voor een lokale professionele beeldeditor:

- één semantisch documentmodel;
- een GPU-renderer die daarvan is afgeleid;
- non-destructieve lagen, tekst, vectoren, effecten en bewerkingen;
- web en Electron boven dezelfde applicatiekern;
- herstelbaar en atomair opslaan;
- PSD/PDF-interchange;
- lokale en externe AI-providers;
- een semantisch commandoprotocol dat UI en agents dezelfde undoable operaties laat gebruiken.

De kernbelofte die uit productdocumentatie én code naar voren komt is:

> Een snelle, lokale en betrouwbare professionele beeldeditor voor mensen die serieus gelaagd werk maken of uitwisselen, zonder dat hun gewone editwerk afhankelijk is van een abonnement of een altijd beschikbare server.

Dat is een goede, onderscheidende richting. De app heeft echter meer breedte opgebouwd dan één klein team gemakkelijk als één betrouwbaar product kan dragen. Het grootste risico is daarom niet dat “alles spaghetti” is. Het risico is **concentratie en claimbreedte**: een paar extreem grote façades coördineren bijna de hele app, terwijl PSD-pariteit, Camera Raw-pariteit, web, desktop, AI, agentbediening, tekst, vectoren, recovery en commerciële distributie allemaal tegelijk productierijp moeten voelen.

### Mijn eindoordeel

**Technisch fundament: sterk. Productierijpheid als geheel: nog niet bewezen.**

De belangrijkste redenen:

1. De actuele structurele kwaliteitsgate faalt op 16 grote bronbestanden; zeven bestaande ratchets zijn overschreden.
2. De architectuurdocumentatie en UI-boundary-audit zijn niet groen.
3. Er zit een concrete listener-accumulatie in drie AI-pollingpaden.
4. Het externe MCP-commandocontract is aantoonbaar uit synchronisatie met de desktop-adapter.
5. De oorspronkelijke initiale webchunk bevatte een 8,6 MB gegenereerde
   Color/Vibrance-bibliotheek; dit risico is inmiddels opgelost en de actuele
   hoofdchunk meet 2,85 MB raw / 0,76 MB gzip.
6. De actuele productie-dependency-audit meldt drie high-severity kwetsbare packages.
7. Bescheiden hardware, Apple Silicon, web-hosting en een actuele meeruurs-soak zijn niet gekwalificeerd.
8. Belangrijke zichtbare productclaims — vooral Grade/Camera Raw en volledig bewerkbare PSD-uitwisseling — hebben nog open acceptatiewerk.

Tegelijk moet het positieve niet worden onderschat: typecheck, webbuild, distributiegrens en **2.989 tests** slagen. Save/recovery, GPU dirty-state, caches, documentrevisies en interchange-evidence zijn bovengemiddeld zorgvuldig ontworpen.

## 2. Bewijsstatus en beperkingen

Ik gebruik vier labels:

- **Bewezen:** direct aangetoond door actuele code, een uitgevoerde gate of buildoutput.
- **Sterk onderbouwd:** meerdere onafhankelijke code- en documentbronnen wijzen dezelfde kant op.
- **Risico:** aannemelijk, maar er is runtimebewijs nodig om impact of bereik vast te stellen.
- **Open vraag:** product- of eigenaarsoordeel ontbreekt.

Deze audit is uitgevoerd op commit `df04034d4e24a8317daaac8751d754087cb30a1c`, op een reeds vuile working tree. De bestaande wijzigingen zijn niet van deze audit en zijn niet aangepast. Daardoor is dit een audit van de **actuele lokale staat**, niet van een schone releasecandidate.

Wel uitgevoerd:

- volledige repository-onboarding en actieve taakcontext;
- bron-, package-, dependency- en importsysteeminventarisatie;
- `npm run typecheck` — geslaagd;
- `npm test` — geslaagd, 2.989 tests;
- `npm run build:web` — geslaagd;
- `npm run verify:boundary` — geslaagd;
- `npm run audit:source-structure` — gefaald;
- `npm run audit:architecture-docs` — gefaald;
- `npm run audit:ui-boundary` — gefaald;
- `npm run verify:interchange-matrix` — geslaagd;
- `npm run audit:interchange-evidence` — geslaagd;
- `npm run audit:grade-parity-readiness` — uitgevoerd; meerdere secties zijn partial/stale;
- `npm audit --omit=dev` — drie high-severity packages gemeld.

Niet uitgevoerd:

- alle 52 fysieke Electron-smokes;
- een twee- of twaalfuurs release-soak;
- meting op geïntegreerde GPU, Apple Silicon of meerdere browsers;
- echte providerfacturering of langlopende OpenArt/Higgsfield-jobs;
- gebruikerstesten met de beoogde doelgroep;
- volledige line/branch coverage; de repository rapporteert testaantallen, geen actuele coveragepercentages.

De webbuild heeft alleen genegeerde buildoutput onder `apps/web/dist/` aangemaakt; er is geen applicatiecode gewijzigd.

## 3. Voor wie de app volgens mij wordt gebouwd

De doelgroep staat niet als één marketingpersona gecanoniseerd, maar is goed af te leiden.

### Primaire doelgroep

1. **De abonnementsgevoelige professionele of semiprofessionele fotograaf**
   - werkt veel met Grade, kleur, Lens FX, masks en gelaagde exports;
   - wil grote bestanden lokaal en snel bewerken;
   - wil niet dat openen, opslaan of exporteren stopt wanneer een account- of licentieserver wegvalt;
   - verwacht betrouwbare PSD-handoff.

2. **De designer/contentmaker die serieuze bestanden uitwisselt**
   - heeft tekst, vectoren, stijlen, blend modes en groepen nodig;
   - wil bestaande Photoshopbestanden niet “ongeveer” maar voorspelbaar openen;
   - heeft meer nodig dan een eenvoudige online editor, maar niet noodzakelijk elk publishing- of illustratiegereedschap van Adobe.

3. **De AI-ondersteunde maker of klein creatief team**
   - wil providerkeuze: lokaal, OpenArt of Higgsfield;
   - wil eigen bronmateriaal lokaal houden tenzij een remote taak expliciet wordt gestart;
   - wil gegenereerde resultaten als normale assets/lagen kunnen plaatsen, terugdraaien en hergebruiken;
   - wil mens en agent via dezelfde semantische operaties laten werken.

### Secundaire doelgroep

- webgebruikers die de editor zonder installatie willen proberen of in een host zoals StoryBuilder gebruiken;
- automation/MCP-gebruikers die gelaagde documenten programmatisch willen inspecteren en wijzigen.

### Niet verstandig als eerste marktclaim

- volledige Photoshop-vervanging voor iedere discipline;
- Krita-/painting-vervanging;
- desktop publishing, video of 3D;
- “werkt snel op iedere computer” zolang alleen een sterke Windows discrete-GPU-cel is gemeten;
- perfecte Camera Raw- of PSD-pariteit zolang de bijbehorende matrices nog open zijn.

### De drie productbeloften die behouden moeten blijven

1. **Open en bewaar serieus gelaagd werk zonder verrassingen.**
2. **Laat de meest voorkomende foto- en designbewerkingen direct en non-destructief voelen.**
3. **Laat mens en agent dezelfde begrensde, undoable handelingen uitvoeren.**

Alles wat deze drie beloften niet versterkt, concurreert om onderhoudsbudget met betrouwbaarheid, snelheid en betaalbaarheid.

## 4. Hoe de systemen werkelijk samenhangen

```text
Web-host ─────────────┐
                     ├── @lighttable/app ── document/workspace/history
Electron renderer ───┘          │          editor UI + tools
        │                        │          processing/effects
        │ LightTableHost         ├───────── WebGpuEngine/compositor
        │                        ├───────── text packages + Rust/WASM
        │                        ├───────── vector packages
        │                        ├───────── paint-core / pdf-core
        │                        └───────── semantic command service
        │
Electron main process
        ├── filesystem, native dialogs, atomic saves, recovery, recents
        ├── projects and asset catalog/watchers
        ├── releases/updates and system fonts
        ├── Agent Access bridge + outbound tunnel
        └── GenAI registry
              ├── OpenArt MCP/OAuth
              ├── Higgsfield MCP/OAuth
              └── local-ai-provider process + model manager

External MCP server ── OAuth/PKCE + device tunnel ── desktop Agent Access
```

### Applicaties

| Systeem | Rol | Belangrijkste grens |
| --- | --- | --- |
| `apps/web` | Browserhost en downloads | Mag geen desktop- of projectpaden kennen |
| `apps/desktop` | Electronhost en native capabilities | Is de enige eigenaar van IPC, filesystem, OAuth-secrets, processen en updates |
| `apps/local-ai-provider` | Lokale HTTP/CLI AI-runtime | Geïsoleerde jobs, modellen, output en procescancel |
| `apps/mcp-server` | Externe agent/API-laag | OAuth, scopes, tunnel, remote asset-validatie en semantische commands |

### Packages

| Groep | Packages | Rol |
| --- | --- | --- |
| Applicatie | `lighttable-app` | Veruit grootste package; UI, documents, GPU, effects, I/O en orchestration |
| AI-contracten | `genai-core`, `genai-openart`, `genai-higgsfield`, `genai-local` | Providerneutrale modellen plus adapters |
| Raster | `paint-core` | Host- en rendererneutrale paintcontracten |
| PDF | `pdf-core` | PDF-model en interchangekern |
| Tekst | `text-core`, `text-rendering`, `text-webgpu` | Semantiek → layout → GPU |
| Vector | `vector-core`, `vector-rendering`, `vector-webgpu` | Semantiek → rendering → GPU |
| Native text | `crates/text-layout-wasm` | Rust/WASM shaping en layout |

`packages/text-layout-wasm` lijkt daarnaast een lege/topologisch ambigue map, terwijl de echte crate onder `crates/text-layout-wasm` staat. Dat is geen runtimefout, maar wel repositoryruis.

### Canonieke autoriteit

De belangrijkste architectuurkeuze is gezond:

- `ImageDocument` is de semantische waarheid;
- `DocumentSession` bezit document, editorstate, history, taken en rendererlevenscyclus;
- `WorkspaceSession` bezit meerdere documentsessies en één actieve presentatie;
- GPU-textures, previews, caches en overlays zijn afgeleid;
- hostcapabilities lopen via `LightTableHost`;
- save gebruikt een vastgepinde revisie en markeert nieuwere edits niet per ongeluk als opgeslagen.

Dit voorkomt een groot deel van de klassieke editorproblemen: dubbele waarheid, onundoable previewmutaties en hostpaden in documenten.

## 5. Wat aantoonbaar sterk is

### Data- en herstelveiligheid

**Bewezen.** De atomic writer schrijft een sibling-tempbestand, `fsync`t, valideert, vervangt atomair waar mogelijk en herstelt de vorige file bij fallbackfalen. Symlinktargets worden geweigerd. Recovery is revision-driven in plaats van polling-driven, heeft bounded scheduling en hasht grote artifacts buiten de interactiestroom.

### Renderdiscipline

**Sterk onderbouwd.** Dirty-state onderscheidt bron, document, adjustments, effects, view mode, viewport en histogram. `RenderInvalidationScheduler` coalescet frames, pauzeert achtergrond-documenten zonder dirty state te verliezen en kan voor export flushen. De compositor heeft expliciete regels voor groepen, clipping, masks, attached processing en standalone adjustments.

### Begrensde resources

**Sterk onderbouwd.** Veel caches hebben expliciete byte- of entrybudgetten; document- en workerresources hebben dispose/release-paden; local AI begrenst terminal jobs en outputdirectories; projectindexmutaties zijn geserialiseerd en jobjournals zijn op 500 items begrensd.

### Automatisering als domeinfunctie

**Sterk onderbouwd.** Automation is geen UI-clickrobot. Commands hebben stabiele document-IDs, revisionchecks, taakcancel, bounded artifacts en undo/redo. Dat is een echte productsterkte.

### Testcultuur

**Bewezen.** De actuele suite slaagt met 445 app-testfiles en in totaal 2.989 tests over alle workspaces en policies. Interchange-evidence dekt 79 rijen, 26 van 32 all-mode blends, 48 color-cases, 40 effects en 10 templates.

## 6. Kritieke en hoge risico’s

### R1 — De kwaliteitsbaseline is ingehaald door de app

**Ernst: hoog · Zekerheid: bewezen**

`audit:source-structure` faalt. Dit zijn de actuele uitschieters uit de gate:

| Bestand | Regels volgens audit | Observatie |
| --- | ---: | --- |
| `LightTableEditorOverlay.tsx` | 6.656 | Bestaande cap 4.350; 171 lokale imports |
| `WebGpuEngine.ts` | 3.322 | Bestaande cap 2.290; 59 lokale imports |
| `gpu/shaders.ts` | 2.367 | Bestaande cap 1.055 |
| `apps/desktop/src/main.ts` | 2.168 | Nieuwe >1.000-regel hotspot; 82 IPC-handlers |
| `gpu/layerShaders.ts` | 2.146 | Bestaande cap 1.600 |
| `LayerPanel.tsx` | 1.652 | Bestaande cap 1.155 |
| `documentCommands.ts` | 1.582 | Bestaande cap 1.330 |
| `layeredDocumentFormat.ts` | 1.377 | Bestaande cap 1.210 |
| `psdDocumentAdapter.ts` | 1.240 | Nieuwe hotspot |
| `useViewportInteractionController.ts` | 1.224 | Nieuwe hotspot |
| `lightTableCommandService.ts` | 1.079 | Nieuwe hotspot |
| `LightTableDockWorkspace.tsx` | 1.055 | Nieuwe hotspot |
| `useLayerDocumentCommands.ts` | 1.037 | Nieuwe hotspot |
| `GradePanel.tsx` | 1.037 | Nieuwe hotspot |
| `LightTableStandaloneApp.tsx` | 1.009 | Nieuwe hotspot |

`lighttable.css` telt circa 4.981 regels en `primitives.css` circa 2.327. De grootste onderhoudsrisico’s liggen dus zowel in orchestration als in globale styling.

De app-package domineert de repository: circa 1.111 getrackte sourcebestanden en 244.498 regels inclusief tests en gegenereerde bronnen. Daarvan zijn 445 testfiles / 45.415 testregels. Zonder tests en gegenereerde LUT blijven editor (~43,7k), application (~29,6k), GPU (~9,6k), text (~7,8k) en effects (~6,4k) de grootste domeinen.

**Interpretatie:** dit is geen bewijs dat elk groot bestand slecht is. Het bewijst wel dat de eigen afgesproken veranderingsgrenzen niet meer functioneren als ratchet.

### R2 — Drie “god façades” vormen één grote blast radius

**Ernst: hoog · Zekerheid: bewezen voor omvang, sterk onderbouwd voor veranderingsrisico**

1. `LightTableEditorOverlay.tsx` coördineert vrijwel alle editorcontrollers, dialogs, panels, imports, exports, recovery, workspaceprojectie en toolstate. Een statische telling vond ongeveer 27 `useState`, 46 `useEffect`, 18 `useMemo`, 51 `useCallback` en 111 `useRef`-aanroepen.
2. `WebGpuEngine.ts` bezit documentrendering, adjustments, effects, scopes, histogram, selection, viewport, export/readback, scheduling, overlays en een groot aantal pipelines/resources.
3. `apps/desktop/src/main.ts` bezit files, recovery, projecten, recents, releases, updates, Agent Access, tunnel, providercontrollers, AI-jobs, lokale processen en 82 IPC-handlers.

De onderliggende subsystemen zijn vaak netjes afgebakend. De spaghetti zit vooral **in de coördinatieknooppunten**. Daardoor kan een kleine productwijziging door veel domeinen snijden en wordt het moeilijk om lifecycle, foutafhandeling en security lokaal te bewijzen.

Aanbevolen richting is niet een generieke “manager”-laag, maar extractie per capability: document bootstrap, editor dialogs, project IPC, GenAI IPC, agent IPC, presentation pipelines en resourcefamilies.

### R3 — Concrete AbortSignal-listeneraccumulatie in AI-jobs

**Ernst: hoog · Zekerheid: bewezen uit uitvoeringspad; runtime-impact niet gemeten**

Drie poll-loops voegen bij iedere delay een `{ once: true }` abort-listener toe, maar verwijderen deze listener niet wanneer de timer normaal afloopt:

- `openArtConnectionController.ts` → `abortableDelay`;
- `higgsfieldConnectionController.ts` → `waitBeforePoll`;
- `apps/desktop/src/main.ts` → local-AI statuspoll iedere 125 ms.

`once: true` verwijdert een listener pas **nadat abort optreedt**. Bij normaal timerverloop blijven oude callbacks dus aan hetzelfde signaal hangen tot de job eindigt of wordt geaborteerd.

Higgsfield kan 240 pollrondes uitvoeren; local AI kan bij een lange job veel meer listeners opbouwen. Dit kan geheugen vasthouden, `MaxListenersExceededWarning` veroorzaken en bij cancel veel reeds verlopen callbacks activeren. De bestaande tests dekken jobcancel, maar niet listenerretentie over langlopende polls.

### R4 — Het commandoprotocol heeft drie drijvende waarheden

**Ernst: hoog · Zekerheid: bewezen**

Command-IDs staan afzonderlijk in:

1. `lightTableCommandContract.ts`;
2. `lightTableCommandValidation.ts` / `lightTableMcpAdapter.ts`;
3. `apps/mcp-server/src/mcp.mjs`.

Die lijsten zijn niet gelijk:

- de externe MCP-server biedt `file.exportPsd` aan;
- de desktop `AuthenticatedLightTableMcpAdapter` staat `file.exportPsd` niet toe;
- de adapter kent onder meer `document.create`, `document.resizeImage` en `faceWarp.applyOperation`;
- de externe MCP-server exposeert die niet;
- het volledige interne contract bevat daarnaast duplicate, document geometry en file-openpaden die niet overal beschikbaar zijn.

Gevolg: remote PSD-export wordt als geldig MCP-commando gepresenteerd, maar behoort bij de desktopgrens te worden afgewezen. Er is geen end-to-end contracttest die de externe enum gelijkstelt aan de adaptercapabilities.

### R5 — Color and Vibrance-bootstraprisico is opgelost; modelrisico sterk verlaagd

**Status: gesloten · Zekerheid: gemeten en via packaged WebGPU geverifieerd**

Alle 490 in TypeScript/Base64 ingebedde meetvolumes blijven verwijderd:
8.591.289 bytes gegenereerde bron en 6.136.221 bytes binaire modeldata verdwenen
uit de initiale codeflow. De complete vier-slidertest bewees vervolgens dat de
CAT16 Temperature/Tint-vervanging niet klopte. De actuele adjustment gebruikt
daarom een apart, lazy binair compatibility-asset van 1.686.678 bytes: 72,5%
kleiner dan de oude binaire data en niet onderdeel van de initiële JavaScript.

Na laden staan per actieve Color and Vibrance-laag alleen een 9³ Temperature/
Tint-volume en een 17³ gekoppeld kleurvolume op de GPU, samen circa 22 KB.
Geïsoleerde Vibrance/Saturation blijft via de analytische OKLab-route lopen;
de gemeten tweede trap wordt alleen bij actieve Temperature/Tint gebruikt.

De volledige initiale JavaScriptflow meet nu 2.981.265 bytes raw / 790.549 bytes
gzip. Het compatibility-asset staat daar aantoonbaar buiten als lazy bestand.
Daarmee is de oude 11,09 MB-meting alleen nog een historische baseline, niet de
huidige productkost.

De oude 99,253%-claim is ingetrokken: twee sliders ontbraken volledig. De
provenance-gebonden 40-case portretmatrix rapporteert nu afzonderlijk RGB-RMSE,
MAE, maximum codefout, pixeldekking en OKLab-afstand. Gemiddelde RGB-RMSE is
1,663% voor Temperature, 1,633% voor Tint, 2,053% voor Vibrance, 0,292% voor
Saturation en 1,362% voor de twee gecombineerde ±80-cases. Dertien held-out
gevallen middelen 1,770%. Op een tweede foto middelen de gecombineerde ±80-
extremen 2,197%; de zichtbare zwakste daarvan is +80 op 3,451%. Dit is een
grote verbetering, geen pixel-identieke Photoshop-claim. De grootste lokale
modelrisico's zijn nu Vibrance −100 en sterk warm/verzadigd gecombineerd +80.

### R6 — Actuele production dependency-audit is niet groen

**Ernst: hoog · Zekerheid: bewezen door npm advisorydata op 2026-08-19**

`npm audit --omit=dev` meldt drie high-severity packages:

- `ws@8.18.3`: memory-exhaustion DoS en memory disclosure; actief gebruikt door de MCP-device-tunnel en desktop tunneladapter. Een update naar een niet-getroffen release is beschikbaar.
- `sharp@0.34.5`: getroffen door meerdere libvips-CVE’s volgens `GHSA-f88m-g3jw-g9cj`; npm kent op dit moment geen automatische fix.
- `@huggingface/transformers@3.8.1`: gemarkeerd via de transitieve `sharp`-dependency.

Nuance: Transformers draait in LightTable vooral in browserworkers en gebruikt daar niet vanzelf de Node-`sharp` backend. De root-`sharp` wordt vooral door test/oracle-scripts gebruikt. Dat verkleint mogelijk het shipped attack surface, maar moet via packaging/reachability worden bewezen. `ws` is wel rechtstreeks onderdeel van de netwerkgrens en heeft prioriteit.

De webbuild waarschuwt daarnaast voor direct `eval` in `wasm-vips`. Dat is dependencycode in lazy codecworkers, geen aangetoonde exploit in LightTable, maar CSP-compatibiliteit en toekomstige bundlerhardening verdienen een expliciete test.

### R7 — “Snel en betaalbaar op gewone hardware” is nog geen bewezen claim

**Ernst: hoog commercieel · Zekerheid: bewezen bewijsleemte**

De vastgelegde hardwarebaseline is één Windows discrete-GPU-cel met 64 GiB RAM, één bounded-soakcyclus en 85,9 seconden looptijd. Het bestand zegt zelf dat dit geen overnight-, integrated-GPU-, web- of macOS-kwalificatie is.

Er is goede policycode voor een twee- en twaalfuurs soak en voor monotone heap/GPU-groei. Er is echter geen actuele, exact aan `df04034d` gebonden release-evidence gevonden die deze lange gate doorloopt. De acceptancebaseline van 6 augustus heeft bovendien `ownerSignoff: false`.

Voor de eindgebruiker is dit cruciaal: een snelle editor op een RTX 5090-achtige ontwikkelcel bewijst niet dat een prijsbewuste fotograaf met geïntegreerde GPU een betere ervaring krijgt.

### R8 — Camera Raw/Grade-pariteit is deels compleet en deels stale/open

**Ernst: hoog wanneer als pariteit geclaimd · Zekerheid: bewezen**

De actuele readiness-audit rapporteert:

| Sectie | Staat |
| --- | --- |
| Light | complete, 11/11 |
| Color | complete, 11/11 |
| Curves | representative-complete, 8/11 LightTablecases |
| Local detail | partial, 2/11 compatibel |
| Detail | partial, 1/11 compatibel |
| Color Mixer | stale, 0/11 |
| Point Color | native compleet; Camera Raw-oracle open |
| Color Grading | partial, 0/11 compatibel |
| Black & White | partial, 2/11 compatibel |
| Look Profile | bewuste afwijking |

De implementatie en native evidence zijn verder dan deze cijfers soms doen vermoeden; veel onvolledigheid zit in stale/missing Camera Raw-captures. Voor een gebruiker maakt dat onderscheid echter pas uit wanneer de claim eerlijk wordt geformuleerd. “Beschikbaar” is niet hetzelfde als “bewezen compatibel”.

### R9 — Volledige PSD-editability is nog actief bouwwerk

**Ernst: hoog voor de kernbelofte · Zekerheid: bewezen uit taken en matrices**

Interchange-evidence is sterk en groen, maar actieve taak 142 noemt nog open werk voor:

- verdere compound decomposition;
- lokale fallbacks;
- mask/opacity/blend/group-semantiek;
- 16-bit writerpad;
- Photoshop rebuildmatrix, afhankelijk van taak 203.

Taak 203 heeft infrastructuur voor Photoshop-oracles, maar Black & White, P3, volledige Grade-recaptures en de 10-cycle acceptance zijn nog niet afgerond. Dit is geen reden om PSD zwak te noemen; het is een reden om de claim te begrenzen tot de aantoonbaar groene matrix.

## 7. Middelgrote risico’s en onderhoudsschuld

### R10 — UI-styling is globaal, kwetsbaar en momenteel aantoonbaar regressief

**Ernst: middel/hoog · Zekerheid: bewezen**

De ongetrackte actieve taak 201 toont een zichtbare Image Size-dialogregressie. De Reactfunctionaliteit bestaat, maar alle `.image-size-dialog*`-regels zijn eerder uit `ui/primitives.css` verwijderd. Dit is een concreet voorbeeld van hoe globale CSS-eigenaarschap en grote stylesheets een functioneel complete feature visueel kunnen breken zonder type- of unittests te laten falen.

De UI-boundary-audit faalt ook omdat `ui/AnchorGridControl.tsx` een applicatiedomeintype (`CanvasAnchor`) importeert. Het is slechts een type-import en dus geen runtimecoupling, maar wel een bewezen afwijking van de eigen primitivesgrens.

### R11 — Architectuurdocumentatie loopt achter op de implementatie

**Ernst: middel · Zekerheid: bewezen**

- `SYSTEM_MAP.md` noemt `genai-higgsfield` niet.
- `DOCUMENT_AND_SCENE_MODEL.md` beschrijft text nog als gepland, terwijl `TextLayer` een eersteklas huidig laagtype is.
- QUICKSTART-packagecijfers zijn verouderd.
- De lege/ambigue `packages/text-layout-wasm`-map maakt de crate-topologie minder helder.
- De source-structurebaseline dateert van vóór meerdere nieuwe >1.000-regelbestanden.

Het documentatiesysteem zelf is goed opgezet; het probleem is dat automatische driftcontrole slechts een deel van de waarheid vergelijkt.

### R12 — Type-only modulecycli signaleren onduidelijk contracteigenaarschap

**Ernst: middel/laag · Zekerheid: risico**

Een eenvoudige statische importgraaf van 656 productie-modules en circa 2.400 relatieve edges vond vier strongly connected components:

- vectorcontroller/toolcatalog/editorsession: 7 modules;
- documentsession/history/taskregistry: 3 modules;
- atomic batch contract/command contract: 2 modules;
- text cost model/text renderer: 2 modules.

Meerdere edges zijn `import type` en dus geen runtimecyclus. Dit is geen bewijs van een uitvoeringsbug, wel een signaal dat types bij consumers staan in plaats van bij een lager, zelfstandig contract.

De grootste fan-in zit terecht bij `documentTypes` (~202 importers) en `layerTree` (~71). Daardoor zijn dit stabiele kerncontracten, maar ook de grootste change blast radius.

### R13 — WebGpuEngine-disposal is breed maar niet direct op idempotentie getest

**Ernst: middel · Zekerheid: risico**

`WebGpuEngine.destroy()` ruimt veel listeners, pipelines en childresources op. De methode heeft zelf geen vroeg `destroyed`-guard. Verschillende childowners zijn wel idempotent getest, maar er is geen directe test gevonden die `WebGpuEngine.destroy()` tweemaal uitvoert of een init/destroy-loop op echte GPU-resources controleert.

Dit is geen bewezen leak. Gezien de hoeveelheid resources en React Strict Mode-verwachtingen hoort een directe lifecyclecontracttest wel bij deze façade.

### R14 — Project Mode maakt de AI-belofte minder direct

**Ernst: middel/product · Zekerheid: bewezen gedrag, impact vraagt gebruikerstest**

Generation, Remove Object, job history en assets zijn hard gegated achter een project. Gewone editing, Remove Background en Agent Access werken standalone. Dit is architectonisch verklaarbaar vanwege duurzame assets en jobs, maar UI-copy kan de indruk wekken dat vooral history een project nodig heeft terwijl generation volledig disabled is.

Voor een nieuwe gebruiker die “even AI wil proberen” is dit extra conceptuele frictie. De app moet óf helder uitleggen waarom een project waarde toevoegt, óf een veilige tijdelijke generationflow bieden. Dat is een productkeuze, geen puur technisch defect.

### R15 — Commerciële belofte is beleid, nog geen leverbare lifecycle

**Ernst: middel/hoog voor verkoop · Zekerheid: bewezen**

Het gewenste model is duidelijk en gebruikersvriendelijk: een eenmalige aankoop per major version; lokaal openen, bewerken, opslaan, exporteren en herstellen blijven beschikbaar zonder subscriptionserver.

Maar de runbook verklaart `commercialReady: false` tot prijs/policy, receiptverificatie, activationprovider, updater/rollback en owner approval bestaan. Nog open zijn onder meer prijs, belasting, refundtermijn, support-SLA, device limit, paid-major-upgradebeleid en web-ad/consentcopy.

Betaalbaarheid is dus een sterke ontwerpintentie, nog geen bewezen end-to-end klantbelofte.

## 8. Onvoltooide zaken en actuele werkstaat

### Actieve hoofdtrajecten

- **Taak 141 — Grade/Camera Raw:** veel functionaliteit en evidence aanwezig; meerdere oracles en structurele verschillen blijven open.
- **Taak 142 — PSD processing-layer export:** fundament aanwezig; volledige decomposition, semantics en 16-bit/rebuildacceptatie open.
- **Taak 203 — Photoshop oracle automation:** infrastructuur aanwezig; corpusrecaptures en herhaalde acceptatie open.
- **Taak 201 — Image Size UI:** functioneel pad aanwezig, stylingregressie nog open; taakmap is ongetrackt.

### Werkqueuehygiëne

Een lege `work/todo/task_148`-residu kan context tooling een verkeerde actieve taak laten melden, terwijl taak 148 feitelijk onder `work/done` staat. Lage productimpact, maar onnodig risicovol in een repository die agents via filesystemstate coördineert.

### Weinig TODO’s betekent hier niet “alles af”

Er zijn nauwelijks `TODO`/`FIXME`-markers. Open werk leeft terecht in taakpackages en readinessmatrices. De keerzijde is dat een bronzoektocht de onafgemaakte productstaat sterk onderschat. Voor audits moeten taken, matrices en code altijd samen worden gelezen.

## 9. Productrisico’s vanuit de eindgebruiker bekeken

### Vertrouwen

De sterkste reden om LightTable te kiezen is lokale controle plus betrouwbare interchange. Eén beschadigde save, verkeerd herbouwde PSD of stil gerasteriseerde laag weegt daarom zwaarder dan tien nieuwe tools. De code behandelt dit meestal correct; marketingclaims moeten dezelfde voorzichtigheid tonen.

### Gevoelde snelheid

Gebruikers ervaren geen architectuurdiagram maar pointerlatency, tabwissels, panelupdates, first frame en exporttijd. De renderkern is hier bewust voor ontworpen. De ontbrekende modest-hardwarematrix en zware webbootstrap verhinderen nog de algemene claim dat de ervaring voor prijsbewuste gebruikers daadwerkelijk beter is.

### Betaalbaarheid

Een eenmalige majorversielicentie en serveronafhankelijk lokaal werk passen exact bij de doelgroep. Onderhoudskosten bedreigen die prijsbelofte wanneer het product tegelijk Photoshop, Camera Raw, AI-hub, webeditor en agentplatform probeert te zijn. Scopebeheersing is dus niet alleen engineeringhygiëne, maar prijsstrategie.

### Eerlijkheid

De beste positionering is niet “alles wat Photoshop kan, goedkoper”. Een geloofwaardiger verhaal is:

> Snelle lokale foto- en designediting, sterke gelaagde uitwisseling en vrijwillige AI/automation — zonder dat je gewone werk aan een abonnement of cloud vastzit.

## 10. Aanbevolen volgorde

### P0 — Eerst de bewezen breuken sluiten

1. Upgrade/vervang de getroffen `ws`-versie en leg voor `sharp`/Transformers de werkelijke packaged reachability vast.
2. Maak één canonieke runtimebron voor command-IDs en genereer/valideer MCP- en adapterexposure daaruit; voeg een echte externe-MCP → adaptercontracttest toe.
3. Laat alle abortable delays hun listener bij resolve én reject verwijderen; test 250 normale pollrondes op listenerretentie.
4. Rond taak 201 af en voeg een visuele/componentcontracttest toe die niet alleen de dialog-HTML maar ook de essentiële layoutclass/styles bewaakt.
5. Breng `audit:source-structure`, `audit:architecture-docs` en `audit:ui-boundary` terug naar groen. Behandel gegenereerde artifacts apart van handgeschreven bron, niet door de hele gate ruimer te zetten.

### P1 — De kernbeloften releasewaardig maken

1. Koppel iedere externe claim aan de actuele Grade- en PSD-matrix.
2. Draai een exact-commit tweeuurs release-soak en daarna de 12-uursvariant.
3. Kwalificeer minimaal één geïntegreerde Windows-GPU, één Apple Silicon-cel en de webhost/browsers die echt ondersteund worden.
4. Splits Overlay, WebGpuEngine en desktop main langs bestaande capabilitygrenzen, met behoud van dezelfde semantische autoriteit.
5. Breid de Color/Vibrance-corpus uit met uiteenlopende huidtinten en verzadigde
   niet-huidobjecten voordat dezelfde bescherming een native Grade-default wordt.
6. Voeg bundlebudgetten toe voor initiële JS, CSS, lazy workers/WASM en modellen.

### P2 — Productfocus en betaalbaarheid bewaken

1. Canoniseer één doelgroep/wedge en één lijst met niet-doelen voor de eerste betaalde major.
2. Test de drie kernworkflows met echte fotografen/designers: import → edit → save; PSD handoff; optionele AI-placement.
3. Maak Project Mode-copy eerlijk over wat wordt gegated en waarom.
4. Rond activation, offline receipt, update rollback, prijs en supportbeleid af zonder lokale documentfuncties afhankelijk te maken van serverbeschikbaarheid.
5. Meet onderhouds- en supportkosten per productbelofte; parkeer features die de drie kernbeloften niet versterken.

## 11. Voorgestelde releasecriteria voor de gebruiker die LightTable belooft te helpen

Een eerste betaalde release is wat mij betreft pas verantwoord wanneer:

- alle statische kwaliteitsgates groen zijn;
- geen high-severity direct bereikbare production vulnerability openstaat;
- open/edit/save/recovery/export offline aantoonbaar blijven werken;
- geen monotone heap-, listener- of GPU-groei optreedt in een actuele lange soak;
- de ondersteunde hardwarevloer werkelijk is gemeten;
- iedere geclaimde PSD/Grade-feature een actuele matrixrij heeft;
- de initiële webdownload een expliciet budget haalt;
- de primaire workflows door representatieve gebruikers zonder begeleiding zijn voltooid;
- commerciële copy precies onderscheid maakt tussen current, partial en target.

## 12. Bronnen binnen de repository

Belangrijkste product- en architectuurbronnen:

- [`architecture/PRODUCT_AND_PRINCIPLES.md`](../architecture/PRODUCT_AND_PRINCIPLES.md)
- [`architecture/LIGHTTABLE_PRODUCT_AND_MARKET_ASSESSMENT_2026-08-06.md`](../architecture/LIGHTTABLE_PRODUCT_AND_MARKET_ASSESSMENT_2026-08-06.md)
- [`architecture/SYSTEM_MAP.md`](../architecture/SYSTEM_MAP.md)
- [`architecture/CURRENT_STATE_AND_ROADMAP.md`](../architecture/CURRENT_STATE_AND_ROADMAP.md)
- [`architecture/DOCUMENT_AND_SCENE_MODEL.md`](../architecture/DOCUMENT_AND_SCENE_MODEL.md)
- [`architecture/RENDERING_AND_PROCESSING.md`](../architecture/RENDERING_AND_PROCESSING.md)
- [`architecture/PERFORMANCE_CONTRACT.md`](../architecture/PERFORMANCE_CONTRACT.md)
- [`architecture/HOSTS_IO_AND_PORTABILITY.md`](../architecture/HOSTS_IO_AND_PORTABILITY.md)
- [`architecture/RELIABILITY_AND_VERIFICATION.md`](../architecture/RELIABILITY_AND_VERIFICATION.md)
- [`architecture/COMMERCIAL_OPERATIONS_AND_OUTAGE_RUNBOOK.md`](../architecture/COMMERCIAL_OPERATIONS_AND_OUTAGE_RUNBOOK.md)
- [`architecture/risks/current_risks.md`](../architecture/risks/current_risks.md)

Belangrijkste codegrenzen:

- [`packages/lighttable-app/src/lighttable/LightTableEditorOverlay.tsx`](../packages/lighttable-app/src/lighttable/LightTableEditorOverlay.tsx)
- [`packages/lighttable-app/src/lighttable/gpu/WebGpuEngine.ts`](../packages/lighttable-app/src/lighttable/gpu/WebGpuEngine.ts)
- [`apps/desktop/src/main.ts`](../apps/desktop/src/main.ts)
- [`packages/lighttable-app/src/lighttable/application/documents/documentSession.ts`](../packages/lighttable-app/src/lighttable/application/documents/documentSession.ts)
- [`packages/lighttable-app/src/lighttable/application/workspace/workspaceSession.ts`](../packages/lighttable-app/src/lighttable/application/workspace/workspaceSession.ts)
- [`packages/lighttable-app/src/lighttable/application/commands/lightTableCommandContract.ts`](../packages/lighttable-app/src/lighttable/application/commands/lightTableCommandContract.ts)
- [`packages/lighttable-app/src/lighttable/application/commands/lightTableMcpAdapter.ts`](../packages/lighttable-app/src/lighttable/application/commands/lightTableMcpAdapter.ts)
- [`apps/mcp-server/src/mcp.mjs`](../apps/mcp-server/src/mcp.mjs)
- [`apps/desktop/src/atomicFileWriter.ts`](../apps/desktop/src/atomicFileWriter.ts)
- [`packages/lighttable-app/src/lighttable/application/documents/useDocumentRecoveryJournal.ts`](../packages/lighttable-app/src/lighttable/application/documents/useDocumentRecoveryJournal.ts)

## 13. Slotconclusie

LightTable heeft al iets zeldzaams: een technische architectuur die de juiste professionele eigenschappen serieus neemt — canonieke state, non-destructiviteit, lokale controle, herstelbaarheid, interchange en meetbare performance. Dat fundament rechtvaardigt verdere investering.

Maar de app staat op een kantelpunt. Meer features toevoegen zonder eerst commandodrift, lifecyclelekken, bundlegewicht, kwaliteitsratchets en hardwarebewijs te herstellen zal de betaalbare gebruikerservaring juist duurder en fragieler maken.

De verstandigste volgende fase is daarom geen algemene refactor en ook geen featurestop zonder doel. Het is een **bewijsfase rond de drie kernbeloften**: veilig gelaagd werk, directe lokale editing en dezelfde begrensde operaties voor mens en agent. Als die aantoonbaar groen zijn op gewone hardware, heeft LightTable een geloofwaardig product — niet alleen een indrukwekkende codebase.
