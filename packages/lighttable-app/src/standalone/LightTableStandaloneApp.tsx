import { useState } from 'react';
import { LightTableEditorOverlay } from '../lighttable/LightTableEditorOverlay';
import { createBrowserHost, type LightTableHost } from '../platform/LightTableHost';

interface LightTableStandaloneAppProps {
  host?: LightTableHost;
}

export function LightTableStandaloneApp({
  host = createBrowserHost()
}: LightTableStandaloneAppProps) {
  const [source, setSource] = useState<File | null>(null);
  const [opening, setOpening] = useState(false);

  if (!source) {
    const openFromHost = host.openFile
      ? async () => {
          setOpening(true);
          try {
            const file = await host.openFile?.();
            if (file) setSource(file);
          } finally {
            setOpening(false);
          }
        }
      : null;

    return (
      <main className="lighttable-launcher">
        <section className="lighttable-launcher__card">
          <h1>LightTable</h1>
          <p>Open an image or layered document to start.</p>
          {openFromHost ? (
            <button
              className="action-button lighttable-launcher__open"
              type="button"
              disabled={opening}
              onClick={() => void openFromHost()}
            >
              {opening ? 'Opening…' : 'Open file'}
            </button>
          ) : (
            <label className="action-button lighttable-launcher__open">
              Open file
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/tiff,image/avif,image/vnd.adobe.photoshop,.psd,.lighttable.png"
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  event.currentTarget.value = '';
                  if (file) setSource(file);
                }}
              />
            </label>
          )}
        </section>
      </main>
    );
  }

  return (
    <LightTableEditorOverlay
      open
      projectId=""
      sourceBlob={source}
      fileNameBase={source.name.replace(/\.[^.]+$/, '') || 'Untitled'}
      subjectLabel={source.name}
      onClose={() => setSource(null)}
      onSave={(file, recipe) => host.save({ file, recipe })}
    />
  );
}
