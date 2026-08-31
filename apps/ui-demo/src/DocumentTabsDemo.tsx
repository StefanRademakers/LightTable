import { useRef, useState } from 'react';
import { Button, DocumentTabs, Text, type DocumentTab } from '@lighttable/ui';

const preview = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150"><rect width="240" height="150" fill="#548297"/><circle cx="85" cy="70" r="44" fill="#edc387"/></svg>');
const initial = Array.from({ length: 9 }, (_, index) => ({ id: String(index), title: index === 0
  ? '0001_varken_3d_opaque.webp' : `Document ${index + 1} — composition.png`, dirty: index % 3 === 0, thumbnailUrl: preview }));
export function DocumentTabsDemo() {
  const [documents, setDocuments] = useState<DocumentTab[]>(initial);
  const [activeId, setActiveId] = useState('0');
  const overviewContainer = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState('Right-click a tab or hover an inactive tab.');
  const close = (id: string) => {
    const next = documents.filter(item => item.id !== id);
    setDocuments(next);
    if (activeId === id) setActiveId(next[0]?.id ?? '');
  };
  return <>
    <header className="demo-intro"><Text as="h1" variant="large" weight="bold">Document tabs</Text>
      <Text as="p" tone="muted">30px high. Tabs shrink to 120px, then scroll without a scrollbar. The overflow menu keeps every document reachable.</Text></header>
    <section className="demo-section">
      <div className="demo-document-tabs-size">
        <DocumentTabs documents={documents.map(item => ({ ...item, onClose: () => close(item.id) }))}
          activeId={activeId} onSelect={setActiveId}
          overview={{ container: overviewContainer }}
          onDocumentDragStart={(event, item) => { event.dataTransfer.setData('text/plain', item.id); setFeedback(`Dragging ${item.title}`); }}
          contextMenu={item => [
            { value: 'reveal', label: 'Open file location', onClick: () => setFeedback(`Reveal requested: ${item.title}`) },
            { value: 'reference', label: 'Add as reference', onClick: () => setFeedback(`Reference requested: ${item.title}`) }
          ]} />
        <div ref={overviewContainer} className="demo-document-overview-surface">
          {documents.find(item => item.id === activeId)?.thumbnailUrl ? <img src={preview} alt="Active document preview" /> : null}
        </div>
      </div>
      <Text as="p" tone="muted">{feedback}</Text>
      <Button onClick={() => { setDocuments(initial); setActiveId('0'); }}>Reset documents</Button>
    </section>
  </>;
}
