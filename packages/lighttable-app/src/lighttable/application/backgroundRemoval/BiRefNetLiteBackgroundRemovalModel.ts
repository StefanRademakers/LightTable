import { Ben2BackgroundRemovalModel } from './Ben2BackgroundRemovalModel';
import { BIREFNET_LITE_BENCHMARK_PROFILE } from './backgroundRemovalModels';

/**
 * Benchmark adapter only. It deliberately shares the exact worker, mask and
 * document contract used by BEN2 so an A/B run measures the model rather than
 * a second integration path. The profile must be revision/hash pinned before
 * it can become a production fallback.
 */
export class BiRefNetLiteBackgroundRemovalModel extends Ben2BackgroundRemovalModel {
  constructor() {
    super(BIREFNET_LITE_BENCHMARK_PROFILE);
  }
}
