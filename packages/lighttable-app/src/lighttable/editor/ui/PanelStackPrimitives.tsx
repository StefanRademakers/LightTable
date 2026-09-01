import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import {
  TreeButtonRow,
  TreeDisclosure,
  TreeRow,
  handleTreeCollectionNavigation
} from '@lighttable/ui';

export const PanelStackRow = TreeRow;
export const PanelStackButtonRow = TreeButtonRow;

export const PanelStackDisclosure: React.FC<{
  readonly expanded: boolean;
  readonly label: string;
  readonly className?: string;
  readonly onClick: React.MouseEventHandler<HTMLButtonElement>;
}> = ({ expanded, label, className, onClick }) => (
  <TreeDisclosure expanded={expanded} label={label} className={className}
    onClick={onClick} icon={<img src={lightTableIcon('chevron_layer.png')} alt="" aria-hidden="true" />} />
);

export const handlePanelCollectionNavigation = handleTreeCollectionNavigation;
