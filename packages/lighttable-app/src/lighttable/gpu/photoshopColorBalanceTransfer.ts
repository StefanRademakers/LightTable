import {
  PHOTOSHOP_COLOR_BALANCE_TRANSFER_BASE64,
  PHOTOSHOP_COLOR_BALANCE_TRANSFER_ROWS,
  PHOTOSHOP_COLOR_BALANCE_TRANSFER_WIDTH
} from './photoshopColorBalanceTransfer.generated';

export { PHOTOSHOP_COLOR_BALANCE_TRANSFER_ROWS, PHOTOSHOP_COLOR_BALANCE_TRANSFER_WIDTH };

export const decodePhotoshopColorBalanceTransfer = (): Uint8Array<ArrayBuffer> => {
  const binary = atob(PHOTOSHOP_COLOR_BALANCE_TRANSFER_BASE64);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
};
