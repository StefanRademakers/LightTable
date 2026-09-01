import { Button, Dialog, FieldRow, Text, TextInput } from '@lighttable/ui';
import { useState } from 'react';

type DialogExample = 'confirm' | 'form' | 'destructive' | 'information' | null;

export function DialogsDemo() {
  const [example, setExample] = useState<DialogExample>(null);
  const [name, setName] = useState('Background copy');
  const close = () => setExample(null);

  return <>
    <header className="demo-intro">
      <Text as="h1" variant="large" weight="bold">Dialogs</Text>
      <Text as="p" tone="muted">One flat modal shell. Content is composed from standard package controls.</Text>
    </header>
    <section className="demo-section" aria-labelledby="dialog-types-title">
      <Text as="h2" variant="large" weight="bold" id="dialog-types-title">Dialog types</Text>
      <div className="demo-button-row">
        <Button onClick={() => setExample('confirm')}>Confirmation</Button>
        <Button onClick={() => setExample('form')}>Form</Button>
        <Button onClick={() => setExample('destructive')}>Destructive</Button>
        <Button onClick={() => setExample('information')}>Information</Button>
      </div>
      <Text as="p" variant="small" tone="muted">Escape closes. Tab stays inside the dialog and returns focus when closed.</Text>
    </section>

    <Dialog open={example === 'confirm'} title="Confirm action"
      description="Explain what will happen in one short, concrete sentence."
      onDismiss={close}
      footer={<><Button tabIndex={0} onClick={close}>Cancel</Button><Button tabIndex={0} onClick={close}>Continue</Button></>} />

    <Dialog open={example === 'form'} as="form" title="Rename layer" onDismiss={close}
      onSubmit={(event) => { event.preventDefault(); close(); }}
      footer={<><Button tabIndex={0} type="button" onClick={close}>Cancel</Button><Button tabIndex={0} type="submit">Save</Button></>}>
      <FieldRow label="Name" layout="column"><TextInput tabIndex={0} autoFocus value={name}
        onChange={(event) => setName(event.currentTarget.value)} /></FieldRow>
    </Dialog>

    <Dialog open={example === 'destructive'} title="Delete layer?"
      description="This cannot be undone after the document is closed."
      onDismiss={close}
      footer={<><Button tabIndex={0} onClick={close}>Cancel</Button><Button tabIndex={0} intent="destructive" onClick={close}>Delete</Button></>} />

    <Dialog open={example === 'information'} title="Application" description="Release and update status"
      onDismiss={close}
      footer={<><Button tabIndex={0}>Check for updates</Button><Button tabIndex={0} onClick={close}>Close</Button></>}>
      <FieldRow label="Version"><Text>0.1.0</Text></FieldRow>
      <FieldRow label="Channel"><Text>Development</Text></FieldRow>
    </Dialog>
  </>;
}
