# Kort plan: LightTable stabiel maken zonder rewrite

## Kort oordeel

De basis van LightTable is bruikbaar. We hoeven de app, documentlaag of renderer
niet opnieuw te bouwen. Het probleem zit vooral in de integratie:

- dezelfde centrale bestanden sturen bitmap, vector, scopes, adjustments,
  documentwissels en tools aan;
- een documentwijziging, history, dirty state, recovery en render-invalidatie
  worden nog niet als een enkele transactie gepubliceerd;
- tijdelijke transformpreviews lopen via meerdere routes en doen soms veel te
  veel werk per muisbeweging;
- laagselectie heeft nu drie eigenaars: de actieve laag zit in het document,
  multiselect in de gedeelde Overlay en de shift-anchor in het LayerPanel;
- async GPU- en bestandswerk is niet overal hard gekoppeld aan document,
  revision en rendererbinding;
- device-loss is alleen end-to-end bewezen voor opnieuw opbouwbare
  vectorcontent; een nieuw device krijgt geen kopie van unsaved rastertextures;
- duizenden lokale tests beschermen niet automatisch de echte combinatie van
  UI, documentdata en pixels in de packaged app.

Daarom konden vectorwijzigingen ogenschijnlijk losse bitmap-, scope-, adjustment-
en transformfuncties breken. Het vectorwerk raakte de gedeelde compositor,
engine, overlay en transformsessie. Dat is een grensprobleem, geen mysterie.

## Wat we behouden

- Een editor-shell, een workspace-layout en een actieve canvas/rendererbinding.
- Canonieke documentdata buiten React en buiten de GPU-caches.
- React voor UI-state en stabiele interfaceprojectie.
- Een gedeelde WebGPU-device met documentgebonden resources.
- De hybride renderer: native WebGPU voor geschikte paden en Vello per zwaar
  vector-island.
- De bestaande package-opdeling voor paint, vector, text en PDF.
- De bestaande gemeenschappelijke GPU-evaluator voor Rasterize/Merge/Flatten.
- UI, Actions en MCP als verschillende routes naar dezelfde semantische
  commands.

We maken dus geen editor per document, geen verborgen prewarm-canvassen en geen
nieuwe tweede document- of renderwaarheid.

## Volgorde

### 1. Eerst de echte gebruikersroutes vastpinnen

Maak een kleine releasekritische set packaged journeys. Die controleert tegelijk
documentrevision, layer tree, history, pixels en timing. Minimaal:

- bitmap openen, bewerken, undo/redo en save/reopen;
- twee bewerkte documenten wisselen zonder dat data verandert;
- raster/vector/text/group/multiselect transformeren;
- gradients, masks en attached adjustments laten meebewegen en renderen;
- scopes en thumbnails verversen;
- rasterize/merge voor elk bestaand laagtype;
- dezelfde representatieve edit via UI, Action en MCP;
- renderer rebind en device loss zonder dataverlies.

Neem cold Explorer/Open With en warm JPEG-open expliciet mee. De huidige koude
route begint file-read en GPU-prepare pas nadat window, renderer-app en React-
subscription bestaan. Meet daarom vanaf padacceptatie tot eerste bruikbare
pixel; optimaliseer niet op alleen decode- of Vite-tijd.

De device-lossroute moet daarbij bewust unsaved paint, paste, rasterize, masks
en undo-resources bevatten. De bestaande VORTEXT-test bewijst alleen dat
canonieke vectors na een nieuw GPU-device opnieuw kunnen worden geprojecteerd.

Voor clipboard testen we twee verschillende contracten: de interne GPU-copy
moet exact blijven, terwijl de OS-route expliciet 8-bit straight-alpha sRGB is.
De huidige route-equivalentietest bewijst UI/Action/MCP, maar nog geen echte
Windows/macOS roundtrip, extern vervangen clipboard, ICC of alpha-randen.

Een screenshot alleen is niet genoeg. Alleen een state-test ook niet. Beide
moeten overeenkomen.

We gebruiken hiervoor de bestaande desktop-smokes en
`COMPLETE_APP_QUALITY_GATE.md`. De verandering is dat de belangrijkste
invarianten, platformen, budgetten en vereiste meetartefacten een uitvoerbaar
release-manifest worden; geen nieuw parallel testsysteem.

### 2. Een documentedit wordt een echte commit

Iedere geslaagde edit levert een `DocumentChangeSet`: welke revision veranderde,
welke lagen/pixels/geometry/effecten veranderden, welke bounds dirty zijn en
welke resources/history/recovery geraakt worden.

History, dirty state, recovery, events en render-invalidatie volgen daarna uit
diezelfde commit. Tab-, workspace-, focus-, panel- en toolwissels maken nooit
zo'n commit en kunnen dus geen documentdata veranderen.

Laagselectie wordt tegelijk documentgebonden editorstate: actieve laag,
multiselect en shift-anchor reizen met de documenttab mee. De globale tool en
toolopties blijven applicatiestaat. Een selectiewijziging veroorzaakt geen
contentrevision, history, dirty state of render-invalidatie; het LayerPanel
toont de selectie maar repareert haar niet achteraf.

### 3. Async werk krijgt harde identiteit

Save, export, thumbnails, scopes, hit tests, rasterize en andere async/GPU-taken
krijgen een token met document-ID, sessiegeneratie, rendererbinding, revision en
target-ID. Is een document ondertussen gewisseld of veranderd, dan wordt het
resultaat weggegooid of opnieuw gestart. Het mag nooit op het nieuwe actieve
document landen.

Dezelfde regel geldt tijdens openen: een snelle tijdelijke SVG-preview mag,
maar krijgt een eigen tijdelijke presentatie-identiteit. Decoder/importer,
canonieke publicatie en rendererbinding mogen niet meer als één impliciete
"prepare"-stap door elkaar lopen.

### 4. Transform wordt de eerste snelle verticale slice

Tijdens drag veranderen React en het canonieke document niet. De gesture houdt
een tijdelijke transformdelta buiten React en laat alleen de getroffen content
en GPU-gizmo opnieuw presenteren. Op mouse-up volgt precies een documentcommit
en een history-entry.

We beginnen met een enkele raster/vectorlaag, daarna multiselect, groups, linked
masks, scale en rotate. Path Selection mag hetzelfde gesturecontract gebruiken,
maar behoudt elementniveau als target.

De gate is concreet: broncontent blijft zichtbaar, gradient blijft vastzitten,
gizmo en content volgen binnen een frame op de packaged referentiemachine, er
zijn nul React/canonical updates tijdens pointermove en cancel/undo zijn exact.
De huidige canvas-audit bewijst dit nog niet: hij annuleert Transform zonder
drag en meet Playwright-wandtijd. We repareren die audit met input-, submit- en
present-frame-ID's plus React-commitmeting voordat we de Move-code veranderen.

Dezelfde vorm van gate komt voor processing: maak een zichtbaar niet-neutraal
attached adjustment, toggle bypass, controleer de werkelijk gepresenteerde
pixels, toggle terug en herhaal undo/redo na document- en workspacewissels.
De huidige unit tests bewijzen de losse command-, projectie- en compositorstappen,
maar niet deze volledige productreis.

### 5. Een evaluatiecontract voor renderen en rasterizen

De laagvolgorde, transforms, masks, clipping, opacity, processing en styles
worden eenmaal gepland. Compositor, scopes, thumbnails, preview, export,
rasterize en merge mogen een ander formaat of backend vragen, maar niet hun
eigen betekenis van de layer stack bouwen.

De bestaande `RasterDocumentOperations` blijft. Daaromheen komt een duidelijke
transactie voor source revision, target space, bounds, baked/preserved
eigenschappen, undo en resource lifetime. Tegelijk lossen we het contractconflict
op waarbij de docs tight bounds eisen maar de code nu full-canvas rasters maakt.

### 6. Daarna pas de grote facades dunner maken

Als de contracten in echte routes werken, kunnen we gedrag mechanisch uit
`LightTableEditorOverlay`, `WebGpuEngine` en desktop `main.ts` halen:

- Overlay wordt een composition/UI-projectielaag;
- callers krijgen kleine renderer-capabilityports in plaats van de complete
  engine;
- desktop krijgt aparte vertrouwde IPC-registrars voor files, recovery, Agent
  Access, AI en projecten;
- optionele AI/MCP/providerinitialisatie blokkeert het eerste window niet.

Een groot bestand kleiner maken is geen doel op zichzelf. Een verantwoordelijkheid
met een duidelijke eigenaar en gate is dat wel.

## Regels tijdens uitvoering

- Een productroute of architectuurgrens per commit.
- `work/todo` blijft een menselijk inputkanaal: alleen de aangewezen task
  uitvoeren; na technische completion naar `work/done`; bevindingen uit de
  daaropvolgende menselijke test worden kleine nieuwe todo's.
- Mechanische verhuizing en gedragswijziging niet in dezelfde commit.
- Oude route tijdelijk als oracle/rollback, daarna verwijderen zodra parity is
  bewezen; geen permanente debug-switches in het product.
- Geen test aanpassen omdat de nieuwe code anders uitkomt. Eerst bepalen welke
  invariant is geschonden.
- Geen volgende fase als documentdata, pixels, undo/save/reopen of latency
  achteruitgaan.
- Releasegedrag meten in `run_release`; `run_clean` blijft Vite/HMR development
  en is niet de definitieve performance-oracle.

## Eerste uitvoerbare stap

Start met Phase 0 en de Move-route. Die combinatie beschermt het grootste
vertrouwensrisico (data die verandert/verdwijnt) en pakt tegelijk de zichtbare
inputlag aan. Pas wanneer die verticale slice stabiel en snel is, breiden we het
contract uit naar adjustments, scopes en destructieve evaluatie.

Dit plan maakt LightTable niet op papier production-ready. Het maakt wel
controleerbaar welke blokkades nog bestaan en voorkomt dat een verbetering aan
de ene rendererroute opnieuw stilletjes een andere editorfunctie breekt.
