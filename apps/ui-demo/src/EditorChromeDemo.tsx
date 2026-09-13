import {
  Button,
  EditorChrome,
  EditorChromeBody,
  EditorChromeHeader,
  EditorMenuBarSurface,
  EditorPanelSurface,
  EditorStatusBar,
  EditorStatusMeta,
  EditorStatusSpacer,
  EditorStatusText,
  EditorToolOptionsBar,
  MenuBar,
  PanelFooter,
  PanelTab,
  SegmentedControl,
  Text
} from '@lighttable/ui';
import { useState } from 'react';

const menuItems = [{ value: 'file', label: 'File' }, { value: 'edit', label: 'Edit' }, { value: 'view', label: 'View' }] as const;
const workspaces = [
  { value: 'photo', label: 'Photo' },
  { value: 'video', label: 'Video' }
] as const;

export function EditorChromeDemo() {
  const [workspace, setWorkspace] = useState<'photo' | 'video'>('photo');
  return <>
    <header className="demo-intro">
      <Text as="h1" variant="large" weight="bold">Editor chrome</Text>
      <Text as="p" tone="muted">Shared application, toolbar, panel and status surfaces. Products supply commands and content.</Text>
    </header>
    <section className="demo-editor-chrome-frame">
      <EditorChrome>
        <EditorChromeHeader>
          <EditorMenuBarSurface>
            <MenuBar label="Example editor menu" items={menuItems} optionsFor={() => []} />
          </EditorMenuBarSurface>
        </EditorChromeHeader>
        <EditorToolOptionsBar aria-label="Example tool settings">
          <div className="demo-editor-tool-options"><Text weight="bold">Transform</Text><Button variant="quiet">Auto select</Button></div>
        </EditorToolOptionsBar>
        <EditorChromeBody>
          <div className="demo-editor-tool-rail" aria-label="Tools" />
          <main className="demo-editor-workspace">
            <Text tone="muted">Product-owned document surface</Text>
            <EditorPanelSurface className="demo-editor-floating-panel">
              <PanelTab selected>Properties</PanelTab>
              <div className="demo-editor-panel-content"><Text>Product-owned panel content</Text></div>
              <PanelFooter style={{ margin: 0 }}><Button variant="quiet">Action</Button></PanelFooter>
            </EditorPanelSurface>
          </main>
        </EditorChromeBody>
        <EditorStatusBar>
          <div />
          <SegmentedControl label="Workspaces" value={workspace} options={workspaces} onChange={setWorkspace} variant="quiet" />
          <EditorStatusText>Ready</EditorStatusText>
          <EditorStatusMeta>1920 × 1080</EditorStatusMeta>
          <EditorStatusSpacer />
          <div />
        </EditorStatusBar>
      </EditorChrome>
    </section>
  </>;
}
