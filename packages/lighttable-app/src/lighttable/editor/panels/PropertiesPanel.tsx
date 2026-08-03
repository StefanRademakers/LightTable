import React from 'react';
import { GradePanel, type GradePanelProps } from './GradePanel';
import { TextPropertiesPanel, type TextPropertiesPanelProps } from './TextPropertiesPanel';

export interface PropertiesPanelProps {
  readonly grade: GradePanelProps;
  readonly text: TextPropertiesPanelProps | null;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ grade, text }) => (
  text ? <TextPropertiesPanel {...text} /> : <GradePanel {...grade} />
);
