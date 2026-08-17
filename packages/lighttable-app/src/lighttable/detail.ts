export interface DetailAdjustments {
  sharpeningAmount: number;
  sharpeningRadius: number;
  sharpeningDetail: number;
  sharpeningMasking: number;
  luminanceNoiseReduction: number;
  luminanceDetail: number;
  luminanceContrast: number;
  colorNoiseReduction: number;
  colorDetail: number;
  colorSmoothness: number;
}

export const createDefaultDetail = (): DetailAdjustments => ({
  sharpeningAmount: 0,
  sharpeningRadius: 1,
  sharpeningDetail: 25,
  sharpeningMasking: 0,
  luminanceNoiseReduction: 0,
  luminanceDetail: 50,
  luminanceContrast: 0,
  colorNoiseReduction: 0,
  colorDetail: 50,
  colorSmoothness: 50
});

export const cloneDetail = (value: DetailAdjustments): DetailAdjustments => ({ ...value });

export const detailIsActive = (value: DetailAdjustments): boolean =>
  value.sharpeningAmount > 0.00001
  || value.luminanceNoiseReduction > 0.00001
  || value.colorNoiseReduction > 0.00001;
