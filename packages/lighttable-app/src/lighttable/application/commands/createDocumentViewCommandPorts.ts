import type { ImageDocument } from '../../editor/document/documentTypes';
import type { DocumentLightTableCommandPorts } from './lightTableCommandContract';

type DocumentViewCommandPorts = Pick<DocumentLightTableCommandPorts,
  'resizeImage' | 'applyDocumentGeometry' | 'assignDocumentProfile' | 'setZoom'>;

export const createDocumentViewCommandPorts = ({
  resizeImage,
  applyDocumentGeometry,
  changeDocument,
  fitZoom,
  actualZoom,
  exactZoom
}: {
  readonly resizeImage: NonNullable<DocumentViewCommandPorts['resizeImage']>;
  readonly applyDocumentGeometry: NonNullable<DocumentViewCommandPorts['applyDocumentGeometry']>;
  readonly changeDocument: (change: (document: ImageDocument) => ImageDocument) => boolean;
  readonly fitZoom: () => void;
  readonly actualZoom: () => void;
  readonly exactZoom: (percent: number) => void;
}): DocumentViewCommandPorts => ({
  resizeImage,
  applyDocumentGeometry,
  assignDocumentProfile: ({ profile }) => {
    const changed = changeDocument((document) => (
      document.colorSettings.workingProfile === profile
        && document.colorSettings.profileState === 'assigned'
        ? document
        : {
            ...document,
            colorSettings: {
              ...document.colorSettings,
              workingProfile: profile,
              profileState: 'assigned'
            },
            revision: document.revision + 1,
            modifiedAt: Date.now()
          }
    ));
    return { profile, profileState: 'assigned', changed };
  },
  setZoom: (viewport) => {
    if (viewport.zoomMode === 'fit') fitZoom();
    else if (viewport.zoomMode === '100') actualZoom();
    else exactZoom(viewport.scale * 100);
  }
});
