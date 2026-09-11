import type { ImageDocument } from '../../editor/document/documentTypes';
import type { EditorSession } from '../../editor/session/editorSession';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import type { DocumentSession } from '../documents/documentSession';
import type { captureInteractionScope } from '../interactions/captureInteractionScope';
import {
  createResizePlan, resizeImageDocumentSemantics, type ImageSizeRequest, type ResizePlan
} from '../imageSize/imageSizeModel';
import {
  createDocumentGeometryPlan, projectDocumentGeometry, projectSelectionGeometry,
  projectSelectionTransform, type DocumentGeometryPlan, type DocumentGeometryRequest
} from './documentGeometryModel';
import {
  commitDocumentSurfaceMutation, type CommitDocumentSurfaceMutationInput,
  type ReversibleDocumentSurfaceMutation
} from './commitDocumentSurfaceMutation';

export interface DocumentSurfaceRenderer {
  captureSelectionSnapshot: CommitDocumentSurfaceMutationInput['captureSelectionSnapshot'];
  restoreSelectionSnapshot: CommitDocumentSurfaceMutationInput['restoreSelectionSnapshot'];
  resizeDocumentSurface(document: ImageDocument): void;
  resizeImagePixels(document: ImageDocument, plan: ResizePlan, noiseReduction: number): ReversibleDocumentSurfaceMutation;
  applyDocumentGeometryPixels(document: ImageDocument, plan: DocumentGeometryPlan): ReversibleDocumentSurfaceMutation;
}

interface SurfaceCommandPorts {
  readonly session: Pick<DocumentSession, 'acquirePublicationAdmission'> | undefined;
  readonly mutations: Pick<DocumentMutationController, 'begin'>;
  captureScope(): ReturnType<typeof captureInteractionScope>;
  settleInteraction(): Promise<void>;
  getRenderer(): DocumentSurfaceRenderer | null;
  getDocument(): ImageDocument | null;
  getSelection(): Pick<EditorSession, 'selection' | 'selectionMaskSnapshot'>;
  readonly publication: Pick<CommitDocumentSurfaceMutationInput,
    'publishDocumentSelection' | 'pushHistoryEntry' | 'publishHistoryState'>;
}

type Selection = CommitDocumentSurfaceMutationInput['beforeSelection'];
interface PreparedSurfaceEdit {
  readonly document: ImageDocument;
  readonly selection: Selection;
  createRuntimeMutation(): ReversibleDocumentSurfaceMutation;
}

/**
 * One admission/planning route for whole-document surface edits. Geometry and
 * pixel algorithms stay in their existing owners; the compound publisher owns
 * rollback/history. No UI, command queue, GPU resource cache or preview state.
 */
export class DocumentSurfaceCommandService {
  constructor(private readonly ports: SurfaceCommandPorts) {}

  resizeImage = (request: ImageSizeRequest): Promise<boolean> => this.execute(
    { type: 'document.image-size', label: 'Image Size' },
    (before, selection, renderer) => {
      const plan = createResizePlan(before, request);
      const document = resizeImageDocumentSemantics(before, request);
      if (document === before) return null;
      return {
        document,
        selection: plan.targetWidth === plan.sourceWidth && plan.targetHeight === plan.sourceHeight
          ? selection : projectSelectionTransform(selection, {
            a: plan.scaleX, b: 0, c: 0, d: plan.scaleY, tx: 0, ty: 0
          }),
        createRuntimeMutation: () => renderer.resizeImagePixels(before, plan, request.preserveDetailsNoiseReduction)
      };
    }
  );

  applyGeometry = (request: DocumentGeometryRequest): Promise<boolean> => this.execute(
    {
      type: `document.${request.operation}`,
      label: request.operation === 'canvas-size' ? 'Canvas Size'
        : request.operation === 'crop' ? 'Crop'
          : request.operation === 'flip' ? 'Flip Canvas' : 'Image Rotation'
    },
    (before, selection, renderer) => {
      const plan = createDocumentGeometryPlan(before, request);
      const m = plan.oldDocumentToNewDocument;
      if (plan.targetWidth === before.width && plan.targetHeight === before.height
        && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0) return null;
      return {
        document: projectDocumentGeometry(before, plan),
        selection: projectSelectionGeometry(selection, plan),
        createRuntimeMutation: () => renderer.applyDocumentGeometryPixels(before, plan)
      };
    }
  );

  private async execute(
    history: CommitDocumentSurfaceMutationInput['history'],
    prepare: (before: ImageDocument, selection: Selection, renderer: DocumentSurfaceRenderer) => PreparedSurfaceEdit | null
  ): Promise<boolean> {
    const p = this.ports;
    const session = p.session;
    if (!session) throw new Error(`${history.label} requires an admitted document session.`);
    const scope = p.captureScope();
    const renderer = p.getRenderer();
    if (!renderer) throw new Error('The document renderer is unavailable.');
    await p.settleInteraction();
    scope.assertCurrent();
    // Settlement may commit a transform. Bind the resulting document/selection,
    // never its earlier revision, but reject a different session or renderer.
    const transaction = p.mutations.begin(history.type, history, undefined, 'cancel');
    if (!transaction) throw new Error(`${history.label} could not acquire the active document.`);
    const before = transaction.before;
    const { selection, selectionMaskSnapshot } = p.getSelection();
    try {
      const prepared = prepare(before, [...selection], renderer);
      if (!prepared) { transaction.cancel(); return false; }
      const committed = await commitDocumentSurfaceMutation({
        transaction,
        afterDocument: prepared.document,
        beforeSelection: [...selection],
        afterSelection: prepared.selection,
        beforeSelectionMask: selectionMaskSnapshot,
        history,
        acquirePublicationAdmission: () => session.acquirePublicationAdmission(
          `${history.label} is preparing a document-wide publication.`
        ),
        originIsCurrent: () => scope.isCurrent() && p.getDocument() === before
          && p.getSelection().selection === selection
          && p.getSelection().selectionMaskSnapshot === selectionMaskSnapshot,
        runtimeIsCurrent: scope.isCurrent,
        captureSelectionSnapshot: () => renderer.captureSelectionSnapshot(),
        restoreSelectionSnapshot: snapshot => renderer.restoreSelectionSnapshot(snapshot),
        createRuntimeMutation: prepared.createRuntimeMutation,
        resizeDocumentSurface: document => renderer.resizeDocumentSurface(document),
        ...p.publication
      });
      if (!committed) throw new Error(`${history.label} did not complete.`);
      return true;
    } catch (reason) {
      transaction.cancel();
      throw reason;
    }
  }
}
