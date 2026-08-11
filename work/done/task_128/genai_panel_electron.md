# GenAI-panel in een offline Electron-app

## Overzicht

Het GenAI-panel bestaat uit drie delen:

1. een optioneel zijpaneel voor assets, prompts, shots en de renderqueue;
2. een setup-paneel voor modus, workflow, referentie-assets, prompt en generatie-instellingen;
3. een resultatenpaneel met renderhistorie.

De gebruiker kiest een workflow, voegt lokale images/video/audio als referentie toe, schrijft een prompt en start een renderjob. Paneelbreedtes, de actieve workflow, prompt en references worden per project bewaard.

De huidige hoofdimplementatie staat in `client/src/pages/GenAIPage.tsx`. De prompteditor staat los in `client/src/components/common/SmartPromptField.tsx`.

## Bestandslocaties op disc

De huidige repositoryroot is:

```text
D:\mediavibe\StoryBuilderOnline
```

Belangrijkste bestanden:

| Onderdeel | Absoluut pad op disc | Pad vanaf repositoryroot |
| --- | --- | --- |
| Volledig GenAI-panel en orchestration | `D:\mediavibe\StoryBuilderOnline\client\src\pages\GenAIPage.tsx` | `client/src/pages/GenAIPage.tsx` |
| Custom promptbox met `@assetname` | `D:\mediavibe\StoryBuilderOnline\client\src\components\common\SmartPromptField.tsx` | `client/src/components/common/SmartPromptField.tsx` |
| Reference-well en assetkaarten | `D:\mediavibe\StoryBuilderOnline\client\src\components\common\MediaReferenceSet.tsx` | `client/src/components/common/MediaReferenceSet.tsx` |
| Renderqueue/API-wrapper en workflowtypes | `D:\mediavibe\StoryBuilderOnline\client\src\utils\aiGeneration.ts` | `client/src/utils/aiGeneration.ts` |
| Media drag-and-drop-payloads | `D:\mediavibe\StoryBuilderOnline\client\src\utils\projectMediaDrag.ts` | `client/src/utils/projectMediaDrag.ts` |
| Lokale sessiepersistentie-hook | `D:\mediavibe\StoryBuilderOnline\client\src\hooks\useSessionPersistentState.ts` | `client/src/hooks/useSessionPersistentState.ts` |
| GenAI-, prompt- en reference-CSS | `D:\mediavibe\StoryBuilderOnline\client\src\styles.css` | `client/src/styles.css` |
| StoryBuilder-routes | `D:\mediavibe\StoryBuilderOnline\client\src\products\storybuilder\routes.tsx` | `client/src/products/storybuilder/routes.tsx` |
| Workspace waarin het panel wordt gemount | `D:\mediavibe\StoryBuilderOnline\client\src\components\layout\WorkspaceLayout.tsx` | `client/src/components/layout/WorkspaceLayout.tsx` |
| Frontend dependencies en versies | `D:\mediavibe\StoryBuilderOnline\client\package.json` | `client/package.json` |
| Aparte TipTap Smart Story-editor | `D:\mediavibe\StoryBuilderOnline\client\src\products\storybuilder\pages\SmartStoryEditorPrototypePage.tsx` | `client/src/products/storybuilder/pages/SmartStoryEditorPrototypePage.tsx` |

Voor het overzetten naar Electron zijn vooral `GenAIPage.tsx`, `SmartPromptField.tsx`, `MediaReferenceSet.tsx` en de bijbehorende regels uit `styles.css` relevant. `aiGeneration.ts` laat het verwachte jobcontract zien, maar kan in de desktop-app worden vervangen door een IPC-adapter.

## Prompt en `@assetname`

De prompt is intern altijd gewone tekst. `SmartPromptField` gebruikt `contentEditable` om bekende tokens zoals `@hero` als visuele badges met thumbnail en preview weer te geven.

Een reference bevat minimaal:

```ts
interface AssetReference {
  refUid: string;       // stabiele interne ID
  displayToken: string; // bijvoorbeeld @hero
  path: string;         // lokaal bestand of adapter-ID
  contentType: string;
  name: string;
  thumbnailPath?: string;
}
```

Daarnaast koppelt een binding-map iedere token aan een reference:

```ts
type MentionBindings = Record<string, {
  refUid: string;
  token: string;
  kind: 'image' | 'video' | 'audio';
}>;
```

Bij het starten van een job worden zichtbare namen vertaald naar de posities die de AI-provider verwacht, bijvoorbeeld `@hero` naar `@image1`. Bewaar naast deze providerprompt ook altijd de originele editorprompt, references en bindings. Daardoor kan een oude render later opnieuw in de editor worden geopend zonder de gebruiksvriendelijke assetnamen kwijt te raken.

## Electron asset-adapter

Laat het React-panel niet direct met `fs` of absolute paden werken. Geef het een kleine adapter die door de Electron preload via `contextBridge` wordt aangeboden:

```ts
interface GenAiAssetAdapter {
  listAssets(projectId: string): Promise<AssetReference[]>;
  chooseFiles(kinds: Array<'image' | 'video' | 'audio'>): Promise<AssetReference[]>;
  getPreviewUrl(refUid: string): Promise<string>;
  readText(refUid: string): Promise<string>;
  resolveGenerationPath(refUid: string): Promise<string>;
  saveOutput(jobId: string, sourcePath: string): Promise<AssetReference>;
}
```

Gebruik in de renderer alleen veilige adapter-ID's en preview-URL's. Laat padvalidatie, bestandstoegang, thumbnails en opslag in het Electron main process plaatsvinden. De bestaande StoryBuilder board/API-calls kunnen dan worden vervangen door deze adapter zonder de prompteditor of paneelopbouw te herschrijven.

De renderqueue kan dezelfde scheiding gebruiken met `startJob`, `cancelJob`, `listJobs` en status-events vanuit het main process. Houd providerdata en herbruikbare editorinput apart.

## Gebruikte libraries

- **React 19** en **React DOM** voor componenten, state, portals en rendering.
- **TypeScript** voor types en adaptercontracten.
- **Vite** voor de huidige frontend-build; in Electron kan dit met bijvoorbeeld Electron Forge of Electron Vite worden gekoppeld.
- **Axios** voor de huidige HTTP-calls. In de offline app vervangt de IPC-adapter het grootste deel hiervan.
- **React Router DOM** voor projectroutes en workspace-navigatie.
- **Lucide React** voor iconen.
- **dnd-kit** wordt elders in de media-UI gebruikt voor drag-and-drop/sortering.
- De promptbox gebruikt bewust **geen externe rich-text-library**; het is een eigen `contentEditable`-implementatie.
- De Smart Story-editor gebruikt apart **TipTap/ProseMirror**, maar die is geen onderdeel van de GenAI-promptbox.

Electron zelf zit nog niet in deze repository en moet in de desktop-app worden toegevoegd.
