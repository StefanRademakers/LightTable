import { IconButton, MaskIcon, PanelSectionHeader } from '@lighttable/ui';
import { useState } from 'react';
import { lightTableIcon } from '../../../assets/icons';
import { CurvesEditor } from '../../CurvesEditor';
import type { CurveChannel } from '../../curves';
import { useGradePresentation } from '../../application/adjustments/adjustmentPresentationStore';
import type { GradePanelProps } from './GradePanel';
import type { AdjustmentInteractionHandle } from '../../application/adjustments/AdjustmentInteractionCoordinator';

/** Focused Properties editor for a standalone Curves adjustment node. */
export const CurvesPropertiesPanel = ({ model, commands }: GradePanelProps) => {
  const adjustments = useGradePresentation(model.adjustmentStore);
  const [channel, setChannel] = useState<CurveChannel>('master');

  return (
    <aside className="lighttable-panel lighttable-grade-panel" aria-label="Curves properties">
      <section className="lighttable-group lighttable-master-group">
        <PanelSectionHeader label="Curves" actions={<>
            <IconButton variant="quiet" type="button" onClick={() => commands.resetGroup('curves')} aria-label="Reset Curves" title="Reset Curves" icon={<MaskIcon src={lightTableIcon('settings_reset.png')} />} />
          </>} />
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
              onChange={(curveChannel, points, handle) => commands.updateCurve(
                curveChannel,
                points,
                handle as AdjustmentInteractionHandle | void
              )}
              onReset={commands.resetCurve}
              onInteractionStart={() => commands.beginAdjustment(`curve:${channel}`)}
              onInteractionEnd={(handle) => commands.endAdjustment(handle as AdjustmentInteractionHandle | void)}
              onInteractionCancel={(handle) => commands.cancelAdjustment(handle as AdjustmentInteractionHandle | void)}
            />
          </div>
        </section>
      </div>
    </aside>
  );
};
