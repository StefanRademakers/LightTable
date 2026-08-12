import type { GenAiAssetId } from '@lighttable/genai-core';

export const PROJECT_ASSET_DRAG_TYPE = 'application/x-lighttable-project-asset-id';

export const writeProjectAssetDrag = (transfer: DataTransfer, assetId: GenAiAssetId, label: string): void => {
  transfer.effectAllowed = 'copy';
  transfer.setData(PROJECT_ASSET_DRAG_TYPE, assetId);
  transfer.setData('text/plain', label);
};

export const readProjectAssetDrag = (transfer: DataTransfer): GenAiAssetId | undefined => {
  const assetId = transfer.getData(PROJECT_ASSET_DRAG_TYPE).trim();
  return assetId ? assetId as GenAiAssetId : undefined;
};

export const containsProjectAssetDrag = (transfer: DataTransfer): boolean =>
  Array.from(transfer.types).includes(PROJECT_ASSET_DRAG_TYPE);
