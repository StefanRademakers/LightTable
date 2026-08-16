import { ButtonBase } from '../../../ui/ButtonBase';
import React, { useState } from 'react';
import { lightTableIcon } from '../../../assets/icons';
import { CurvesEditor } from '../../CurvesEditor';
import type { CurveChannel } from '../../curves';
import { useGradePresentation } from '../../application/adjustments/adjustmentPresentationStore';
import type { GradePanelProps } from './GradePanel';

/** Focused Properties editor for a standalone Curves adjustment node. */
export const CurvesPropertiesPanel = ({ model, commands }: GradePanelProps) => {
  const adjustments = useGradePresentation(model.adjustmentStore);
  const [channel, setChannel] = useState<CurveChannel>('master');

  return (
    <aside className="lighttable-panel lighttable-grade-panel" aria-label="Curves properties">
      <section className="lighttable-group lighttable-master-group">
        <div className="lighttable-group__header">
          <div className="lighttable-master-group__label"><strong>Curves</strong></div>
          <div className="lighttable-group__actions">
            <ButtonBase
              type="button"
              className="lighttable-group__reset"
              onClick={() => commands.resetGroup('curves')}
              aria-label="Reset Curves"
              title="Reset Curves"
            >
              <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
            </ButtonBase>
          </div>
        </div>
      </section>
      <div className="lighttable-panel__controls">
        <section className="lighttable-group">
          <div className="lighttable-group__controls">
            <CurvesEditor
              curves={adjustments.curves}
              channel={channel}
              histogram={model.histogram}
              disabled={!model.metadata}
              onChannelChange={setChannel}
              onChange={commands.updateCurve}
              onReset={commands.resetCurve}
              onInteractionStart={commands.beginAdjustment}
              onInteractionEnd={commands.endAdjustment}
            />
          </div>
        </section>
      </div>
    </aside>
  );
};
