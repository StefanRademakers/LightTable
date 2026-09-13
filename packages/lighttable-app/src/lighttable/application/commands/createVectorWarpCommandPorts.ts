import type { ImageDocument } from '../../editor/document/documentTypes';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import { executeSemanticFaceWarpCommand } from '../effects/faceWarp/semanticFaceWarpCommandExecutor';
import { executeSemanticVectorCommand } from '../vectors/semanticVectorCommandExecutor';
import type { DocumentLightTableCommandPorts } from './lightTableCommandContract';
import { executeSemanticWarpStrokeCommand } from './semanticWarpCommandExecutor';

type VectorWarpCommandPorts = Pick<DocumentLightTableCommandPorts,
  'executeVectorCommand' | 'executeWarpStrokeCommand' | 'executeFaceWarpCommand'>;

/** Adapts vector and warp semantic commands to the one canonical document mutation owner. */
export const createVectorWarpCommandPorts = ({
  getDocument,
  changeDocument,
  createWarpId = kind => `warp-${kind}-${crypto.randomUUID()}`
}: {
  readonly getDocument: () => ImageDocument | null;
  readonly changeDocument: DocumentMutationController['change'];
  readonly createWarpId?: (kind: 'stack' | 'module' | 'stroke') => string;
}): VectorWarpCommandPorts => ({
  executeVectorCommand: command => executeSemanticVectorCommand(command, { changeDocument }),
  executeWarpStrokeCommand: command => executeSemanticWarpStrokeCommand(command, {
    getDocument,
    changeDocument,
    createId: createWarpId
  }),
  executeFaceWarpCommand: command => executeSemanticFaceWarpCommand(command, {
    getDocument,
    changeDocument
  })
});
