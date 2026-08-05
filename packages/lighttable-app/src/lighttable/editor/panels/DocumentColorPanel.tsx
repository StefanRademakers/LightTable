import React from 'react';
import { ActionButton } from '../../../ui/ActionButton';
import type { ImageDocument } from '../document/documentTypes';

export interface DocumentColorPanelProps {
  readonly document: ImageDocument | null;
  readonly onAssignSrgb: () => void;
}

const sourceProfileLabel = (document: ImageDocument) => {
  const source = document.importProvenance?.sourceProfile;
  if (source === 'embedded ICC -> sRGB') return 'Embedded ICC, converted to sRGB';
  if (source === 'no embedded ICC; assumed sRGB') return 'Untagged, assumed sRGB';
  return document.importProvenance ? 'No profile information' : 'New sRGB document';
};

/**
 * Document color semantics, intentionally separate from creative Grade.
 * Controls only appear for operations the current color pipeline can perform
 * truthfully; gamma and renderer compatibility switches do not belong here.
 */
export const DocumentColorPanel = ({
  document,
  onAssignSrgb
}: DocumentColorPanelProps) => (
  <aside className="lighttable-panel" aria-label="Document color">
    {document ? (
      <div className="lighttable-panel__controls">
        <section className="lighttable-group">
          <div className="lighttable-group__header">
            <div className="lighttable-master-group__label"><strong>Document</strong></div>
          </div>
          <div className="lighttable-group__controls lighttable-document-color">
            <dl className="lighttable-document-color__values">
              <div><dt>Mode</dt><dd>RGB</dd></div>
              <div><dt>Bit depth</dt><dd>{document.colorSettings.bitDepth} bit/channel</dd></div>
              <div><dt>Working profile</dt><dd>sRGB</dd></div>
              <div><dt>Profile state</dt><dd>{document.colorSettings.profileState}</dd></div>
              <div><dt>Source</dt><dd>{sourceProfileLabel(document)}</dd></div>
              <div><dt>GPU working data</dt><dd>Linear 16-bit float</dd></div>
            </dl>
            {document.colorSettings.profileState === 'assumed' ? (
              <p className="lighttable-document-color__notice">
                Pixel values are currently interpreted as sRGB because the source supplied no usable profile.
              </p>
            ) : null}
            <div className="lighttable-document-color__actions">
              <ActionButton
                disabled={document.colorSettings.profileState === 'assigned'}
                onClick={onAssignSrgb}
              >
                Assign sRGB
              </ActionButton>
              <ActionButton
                disabled
                title="The document is already normalized to the sRGB working profile."
              >
                Convert profile…
              </ActionButton>
            </div>
          </div>
        </section>
      </div>
    ) : <div className="lighttable-panel__empty">No document</div>}
  </aside>
);
