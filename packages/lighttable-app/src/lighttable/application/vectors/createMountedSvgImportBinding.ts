import type { DocumentSession } from '../documents/documentSession';
import {
  executeSvgImport, type SemanticSvgImportCommand, type SvgImportDependencies
} from './svgDocumentCodec';

interface MountedSvgImportPorts {
  getCurrentSession(): DocumentSession | undefined;
  captureRendererScope(): { isCurrent(): boolean };
  readonly changeDocument: SvgImportDependencies['changeDocument'];
}

/** A registered port cannot acquire a successor session's import authority. */
export const createMountedSvgImportBinding = (
  session: DocumentSession | undefined, ports: MountedSvgImportPorts
) => (
  command: SemanticSvgImportCommand
) => executeSvgImport(command, {
  changeDocument: ports.changeDocument,
  captureScope: () => {
    const rendererScope = ports.captureRendererScope();
    return { isCurrent: () => session !== undefined
      && ports.getCurrentSession() === session
      && session.getSnapshot().lifecycle === 'ready'
      && rendererScope.isCurrent() };
  }
});
