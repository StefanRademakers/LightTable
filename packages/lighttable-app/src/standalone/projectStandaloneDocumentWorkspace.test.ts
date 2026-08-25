import { describe, expect, it } from 'vitest';
import type {
  DocumentSessionId
} from '../lighttable/application/documents/documentSession';
import {
  DocumentWorkspaceController
} from '../lighttable/application/workspace/documentWorkspaceController';
import {
  projectStandaloneDocumentWorkspace
} from './projectStandaloneDocumentWorkspace';
import type {
  StandaloneDocumentRuntime
} from './standaloneDocumentRuntime';
import { DocumentStartupTimeline } from '../lighttable/application/telemetry/documentStartupTimeline';

const ids = (...values: string[]) => {
  let index = 0;
  return () => values[index++] as DocumentSessionId;
};

const file = (name: string) => new File(['image'], name, {
  type: 'image/png',
  lastModified: 1
});

const runtime = (
  sourceFile: File,
  decodeMode: StandaloneDocumentRuntime['decodeMode']
): StandaloneDocumentRuntime => ({
  kind: 'image',
  file: sourceFile,
  decodeMode,
  startupTimeline: new DocumentStartupTimeline(() => 0)
});

describe('projectStandaloneDocumentWorkspace', () => {
  it('projects ordered host runtimes and application sessions without copying them', () => {
    const controller = new DocumentWorkspaceController<StandaloneDocumentRuntime>({
      createId: ids('one', 'two')
    });
    const firstFile = file('first.png');
    const secondFile = file('second.png');
    const first = controller.open({
      source: { id: 'first', name: firstFile.name, mediaType: firstFile.type },
      payload: runtime(firstFile, 'fast')
    });
    const second = controller.open({
      source: { id: 'second', name: secondFile.name, mediaType: secondFile.type },
      payload: runtime(secondFile, 'preserve-precision')
    });
    if (!first.ok || !second.ok) throw new Error('Fixture failed to open.');
    first.value.markChanged();

    const projected = projectStandaloneDocumentWorkspace(
      controller,
      controller.getSnapshot()
    );

    expect(projected.map(({ id, active, dirty }) => ({ id, active, dirty }))).toEqual([
      { id: 'one', active: false, dirty: true },
      { id: 'two', active: true, dirty: false }
    ]);
    expect(projected[0]?.runtime.file).toBe(firstFile);
    expect(projected[0]?.session).toBe(first.value);
    expect(projected[1]?.kind).toBe('image');
    if (projected[1]?.kind !== 'image') throw new Error('Expected image workspace document.');
    expect(projected[1].runtime.decodeMode).toBe('preserve-precision');
  });

  it('does not expose a closed document or its host payload', () => {
    const controller = new DocumentWorkspaceController<StandaloneDocumentRuntime>({
      createId: ids('one')
    });
    const sourceFile = file('first.png');
    const opened = controller.open({
      source: { id: 'first', name: sourceFile.name, mediaType: sourceFile.type },
      payload: runtime(sourceFile, 'fast')
    });
    if (!opened.ok) throw new Error('Fixture failed to open.');

    controller.close(opened.value.id);

    expect(projectStandaloneDocumentWorkspace(
      controller,
      controller.getSnapshot()
    )).toEqual([]);
  });
});
