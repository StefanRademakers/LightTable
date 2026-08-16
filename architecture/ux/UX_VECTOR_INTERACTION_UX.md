Het fundamentele interactiemodel

Er zijn in Photoshop drie selectieniveaus:

Laag/objectniveau — Move Tool, V
Volledig path component / volledige shape — Path Selection Tool, zwarte pijl, A
Anchors, handles en segmenten — Direct Selection Tool, witte pijl, eveneens A

Een vectorlaag kan meerdere losse path components bevatten. De zwarte pijl selecteert zo’n component binnen de laag; de witte pijl selecteert onderdelen van dat component. De gewone Move Tool verplaatst daarentegen de volledige laag. Dat onderscheid is de kern van het Adobe-gevoel.

Tooloverzicht
Tool	Hoofdtaak	Photoshop-shortcut
Path Selection	Hele shape/path component selecteren en verplaatsen	A
Direct Selection	Anchors, handles en segmenten bewerken	A
Pen	Paths tekenen, verlengen en sluiten	P
Add Anchor Point	Punt in bestaand segment toevoegen	geen eigen standaardtoets
Delete Anchor Point	Punt uit path verwijderen	geen eigen standaardtoets
Convert Point	Corner/smooth en gekoppelde/losse handles converteren	geen eigen standaardtoets
Shape tools	Rectangle, ellipse, polygon, line enzovoort	U
Move Tool	Hele vectorlaag verplaatsen	V
Free Transform	Geselecteerde path, component of punten transformeren	Ctrl/Cmd+T

A, P en U zijn toolgroepen. Photoshop kan met herhaald indrukken of met Shift+A, Shift+P en Shift+U door de groep wisselen, afhankelijk van de voorkeur Use Shift Key for Tool Switch. Adobe ondersteunt daarnaast spring-loaded tools: een tooltoets vasthouden schakelt tijdelijk naar die tool en loslaten keert terug.

1. Path Selection Tool — zwarte pijl

Dit is geen algemene object-selectietool, maar een component-selectietool binnen vectorcontent.

Klikken
Klik op een shape/path component: selecteer het volledige component.
Bestaat een vectorlaag uit meerdere components, dan wordt alleen het component onder de cursor geselecteerd.
Shift+klik: component aan de selectie toevoegen.
Shift+klik op een geselecteerd component: uit de selectie verwijderen.
Klik op lege canvasruimte: componentselectie opheffen, maar de vectorlaag hoeft niet uit de Layers-selectie te verdwijnen.

Bij een gesloten gevulde shape moet de gebruiker ook in het binnenvlak kunnen klikken. Bij een open path of shape zonder fill gebeurt selectie via het zichtbare segment.

Slepen
Slepen op een geselecteerd component: alle geselecteerde components verplaatsen.
Alt/Option+slepen: component dupliceren en de kopie bewegen.
Marquee vanaf lege ruimte: meerdere path components selecteren.
Pijltjestoets: geselecteerde component(s) één documentpixel verplaatsen.
Shift+pijltjestoets: tien documentpixels.

Photoshop ondersteunt met deze tool ook verwijderen, dupliceren, uitlijnen, distribueren, rangschikken en path operations op componentniveau.

Transformeren

Met een volledig component geselecteerd:

Ctrl/Cmd+T: Transform Path
optionele Show Transform Controls in de options bar
schaal-, rotatie- en transformhandles gelden voor de volledige componentselectie

Wanneer slechts enkele anchors of segmenten geselecteerd zijn, wordt dezelfde opdracht Transform Points.

Options bar

Voor Lighttable hoort de zwarte pijl ongeveer dit te tonen:

Select: Active Layer(s) / All Layers
Path Operations
Path Alignment
Path Distribution
Path Arrangement / stacking
Show Transform Controls

Photoshop kan paths zowel binnen actieve lagen als over meerdere lagen selecteren.

2. Direct Selection Tool — witte pijl

Dit is de echte path-editingmodus.

Klikken en selecteren
Klik op anchor: alleen die anchor selecteren.
Shift+klik: anchor, handle of segment aan de selectie toevoegen of eruit verwijderen.
Marquee vanaf lege ruimte: meerdere anchors/segmenten selecteren.
Alt/Option+klik binnen een component: het volledige component selecteren zonder naar de zwarte pijl te wisselen.
Klik op een curved segment: segment activeren en relevante handles tonen.
Klik op lege ruimte: puntselectie opheffen, maar het actieve path zichtbaar houden.

Photoshop toont geselecteerde anchors gevuld, niet-geselecteerde anchors hol en direction handles als gevulde ronde punten. Dat visuele verschil moet ook bij kleine zoomniveaus duidelijk blijven.

Bewerken
Anchor slepen: anchor verplaatsen.
Handle slepen: curve aan die zijde wijzigen.
Curved segment direct slepen: segment reshapen.
Recht segment slepen: het segment als geheel verplaatsen.
Meerdere geselecteerde anchors slepen: de selectie gezamenlijk verplaatsen.
Shift tijdens slepen: beweging tot stappen van 45 graden beperken.
Pijltjes: één pixel.
Shift+pijltjes: tien pixels.
Smooth handles

Bij een smooth point blijven beide richtingen tangentieel gekoppeld. Wanneer één bestaande handle met Direct Selection wordt versleept:

alleen de lengte van de versleepte handle verandert;
de tegenoverliggende handle hoeft niet even lang te blijven;
beide aangrenzende curven blijven wel door de gedeelde tangent beïnvloed.

Dat is subtiel anders dan tijdens het oorspronkelijk click-draggen met de Pen, waarbij beide handles aanvankelijk symmetrisch worden uitgetrokken.

Segment dragging

Modern Photoshop laat het direct verslepen van een segment ook gerelateerde naastliggende segmenten beïnvloeden. In de options bar bestaat daarom Constrain Path Dragging:

uit: intuïtieve propagatie naar gerelateerde segmenten;
aan: alleen het segment tussen de relevante geselecteerde anchors veranderen.

Dit is een zichtbare UX-optie, geen verborgen technisch detail.

Delete is contextgevoelig

Met Direct Selection:

geselecteerd segment + Delete/Backspace: segment verwijderen;
een gesloten path wordt daarmee geopend;
een open path kan worden opgesplitst;
nogmaals Delete kan het resterende path verwijderen.

Dit is bewust anders dan de Delete Anchor Point Tool.

3. Pen Tool

De Pen moet tijdens gebruik als één contextgevoelige tool voelen, niet als alleen een tool waarmee punten worden neergezet.

Een path beginnen
Klik op lege ruimte: begin nieuw open path met corner point.
Cursor toont dat een nieuw path wordt gestart.
Opnieuw klikken: recht segment.
Klikken en slepen: smooth point met direction handles.
Shift tijdens plaatsen of slepen: richting beperken tot stappen van 45 graden.
Een path sluiten

Wanneer de cursor boven de eerste anchor van het actieve path komt:

cursor krijgt een close-indicator;
klik: path met een recht eindsegment sluiten;
drag: path met een gebogen eindsegment sluiten.
Open path beëindigen

Tijdens actief tekenen:

Ctrl+Enter op Windows;
Cmd+Return op macOS;
of Ctrl/Cmd+klik weg van objecten.

Daarmee blijft het path open, maar stopt de actieve tekenhandeling.

Bestaand open path voortzetten

Hover over een open endpoint:

cursor verandert naar continue-state;
klik activeert dat endpoint;
volgende klik of drag verlengt het path.

Als het endpoint een bestaande uitgaande handle heeft, beïnvloedt die de eerste nieuwe curve.

Twee open paths verbinden
Activeer endpoint van path A.
Hover over endpoint van path B.
Toon een merge-indicator.
Klik om beide paths te verbinden.

Dit moet alleen gebeuren wanneer de cursor duidelijk op een werkelijk endpoint snapt; niet bij willekeurig klikken in de buurt.

4. Tijdelijke modifiers tijdens de Pen Tool

Dit is waarschijnlijk het belangrijkste onderdeel voor Adobe muscle memory.

Ctrl / Cmd — tijdelijk Direct Selection

Zolang de toets wordt vastgehouden:

Pen verandert tijdelijk in Direct Selection;
gebruiker kan een anchor, handle of segment aanpassen;
na loslaten keert de tool terug naar Pen;
de actieve tekenreeks blijft bestaan.

Dit hoort ook te werken vanuit Add Point, Delete Point en Convert Point.

Alt / Option — tijdelijk Convert Point

Zolang de toets wordt vastgehouden, verandert Pen contextueel in Convert Point:

klik op smooth point: handles verwijderen en corner maken;
drag vanaf corner: smooth handles uittrekken;
drag één handle van een smooth point: handles loskoppelen en een corner/cusp maken;
tijdens het tekenen: de uitgaande handle onafhankelijk positioneren, zodat het volgende segment een andere richting krijgt.

Na loslaten keert de tool terug naar Pen.

Spacebar tijdens pointer-down

Zolang de muis of pen nog ingedrukt is:

Spacebar laat de zojuist geplaatste anchor verplaatsen;
direction handles en het plaatsingsgebaar blijven actief;
na pointer-up wordt Spacebar weer de gewone tijdelijke Hand Tool.

Dit is typisch Adobe-gedrag dat ervaren Pen-gebruikers echt missen wanneer het ontbreekt.

5. Add Anchor Point Tool

Deze tool is heel eenvoudig en volledig contextueel:

hover op geldig segment: plus-indicator;
klik: anchor toevoegen;
klik-drag: anchor toevoegen en direct direction handles uittrekken;
buiten een segment: geen actie;
klikken mag de zichtbare vorm van het bestaande segment niet onverwacht laten springen.

In Photoshop wordt dit normaal automatisch door de gewone Pen Tool gedaan wanneer Auto Add/Delete aanstaat. De aparte tool blijft vooral nuttig voor expliciet gedrag en ontdekbaarheid.

6. Delete Anchor Point Tool
Hover over anchor: min-indicator.
Klik: anchor verwijderen en de omliggende pathdelen opnieuw verbinden.
Alleen anchors zijn geldige targets.
Klikken op een segment doet niets.
Dit verwijdert niet automatisch de aangrenzende segmenten zoals Delete/Backspace bij Direct Selection dat doet.

Dat verschil moet heel duidelijk zijn:

Delete Point Tool: punt verwijderen, path behouden.
Direct Selection + Delete: geselecteerd pathonderdeel verwijderen.

Adobe waarschuwt expliciet dat Backspace/Delete niet als vervanging voor de Delete Anchor Point Tool moet worden gebruikt.

7. Convert Point Tool

Dit is geen eenvoudige “toggle smooth/corner”-knop. Het exacte resultaat hangt af van de gesture.

Klik op een smooth point
beide handles verdwijnen;
point wordt een corner;
segmenten lopen recht of eindigen zonder actieve tangenten op dat punt.
Drag vanaf een corner zonder handles
twee tegenovergestelde handles verschijnen;
point wordt smooth;
het draggebaar bepaalt richting en lengte.
Drag één handle van een smooth point
de koppeling tussen beide handles wordt verbroken;
point wordt een corner/cusp met onafhankelijke handles;
alleen de versleepte handle volgt de cursor.
Drag een handle van een corner point
alleen die ene handle verandert;
tegenoverliggende handle blijft ongemoeid.

Photoshop behandelt dus grofweg drie waarneembare situaties:

corner zonder handles;
smooth met gekoppelde richting;
corner met onafhankelijke handles.

Je hebt hiervoor geen reeks aparte point-type-tools nodig; de Convert Point Tool is bewust gesture-driven.

8. Auto Add/Delete

Met deze Pen-optie ingeschakeld:

Pen boven geselecteerd segment → Add Anchor Point;
Pen boven bestaande anchor → Delete Anchor Point;
Pen boven endpoint → continue/connect;
Pen boven eerste actieve anchor → close path;
elders → gewone Pen.

Met Auto Add/Delete uitgeschakeld blijft Pen een pure tekentool. Dat is onder andere nodig om een nieuw path over een bestaand path heen te kunnen starten zonder per ongeluk punten toe te voegen of te verwijderen.

In LightTable staat deze optie standaard aan, maar is ze niet zichtbaar in de bovenste property bar. De Rubber Band is altijd actief en eveneens verborgen; beide kunnen later naar een echte preference verhuizen zonder de compacte werkbalk te belasten.

9. Shape tools en path components

Voor Rectangle, Ellipse, Triangle, Polygon en Line:

U selecteert de shape-toolgroep;
Shift+U of herhaald U wisselt tussen de tools;
drag: shape vanuit hoek tekenen;
Shift+drag: vierkant, cirkel of constrained vorm;
Alt/Option+drag: vanuit het centrum tekenen;
Shift+Alt/Option+drag: constrained én vanuit centrum.

Wanneer binnen dezelfde vectorcontent extra components worden getekend, zijn de verwachte path operations:

Combine
Subtract
Intersect
Exclude Overlap

Photoshop gebruikt tijdens het tekenen ook tijdelijke modifiers: Shift voor toevoegen en Alt/Option voor aftrekken. De zwarte pijl selecteert vervolgens een volledige component; de witte pijl bewerkt de nodes ervan.

10. Photoshop versus Illustrator-shortcuts

Hier moet je bewust kiezen.

Photoshop:

P: Pen, Freeform Pen, Curvature Pen
A: Path Selection / Direct Selection
Add, Delete en Convert Point hebben geen eigen standaardtoets in de huidige Photoshop-shortcutlijst
Convert gebeurt voornamelijk via Alt/Option vanuit Pen

Illustrator-gebruikers verwachten daarnaast:

+: Add Anchor Point
-: Delete Anchor Point
Shift+C: Anchor/Convert Point Tool

Die Illustrator-shortcuts kun je prima als extra compatibiliteitsoptie ondersteunen, maar ik zou ze niet presenteren als de primaire Photoshop preset.

Aanbevolen gedrag voor jouw toolbar

Voor de tools die in je screenshot staan:

Zwarte pijl — volledige vectorcomponenten selecteren/moven
Witte pijl — anchors, handles en segmenten selecteren/editten
Pen — tekenen, verlengen, sluiten; automatisch add/delete
Pen + — expliciet punt toevoegen
Pen − — expliciet punt verwijderen
Convert Point — click/drag-gestures voor corner/smooth/cusp
Shape tools — nieuwe parametrische shapes/components tekenen

De belangrijkste parity-eisen zijn uiteindelijk:

A wisselt zwarte/witte pijl;
P activeert Pen;
Ctrl/Cmd vanuit Pen geeft tijdelijk Direct Selection;
Alt/Option vanuit Pen geeft tijdelijk Convert Point;
Spacebar kan een nieuw point tijdens het plaatsen verschuiven;
Auto Add/Delete verandert de Pen-cursor contextueel;
zwarte pijl werkt op components, witte pijl op geometry;
Delete gedraagt zich anders dan Delete Anchor Point;
cursorfeedback maakt vóór het klikken duidelijk wat er gaat gebeuren;
selectie blijft logisch behouden bij het wisselen tussen zwarte pijl, witte pijl en Pen.
