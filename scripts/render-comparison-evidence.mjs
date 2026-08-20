import sharp from 'sharp';

const quantileFromHistogram = (histogram, quantile, count) => {
  const target = Math.ceil(count * quantile);
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= target) return value;
  }
  return histogram.length - 1;
};

const validateAspectRatio = (left, right, tolerance) => {
  const leftRatio = left.width / left.height;
  const rightRatio = right.width / right.height;
  const relativeDelta = Math.abs(leftRatio - rightRatio) / rightRatio;
  if (relativeDelta > tolerance) {
    throw new Error(`Render aspect ratios diverge: ${left.width}x${left.height} vs ${right.width}x${right.height}.`);
  }
};

export const compareRenderEvidence = async ({
  leftPath,
  rightPath,
  width,
  height,
  sideBySidePath,
  differencePath,
  differenceAmplification = 4,
  aspectRatioTolerance = 0.001,
  policy
}) => {
  const [leftMetadata, rightMetadata] = await Promise.all([
    sharp(leftPath).metadata(),
    sharp(rightPath).metadata()
  ]);
  if (!leftMetadata.width || !leftMetadata.height || !rightMetadata.width || !rightMetadata.height) {
    throw new Error('Both comparison images need readable dimensions.');
  }
  validateAspectRatio(leftMetadata, rightMetadata, aspectRatioTolerance);
  const [left, right, leftPng, rightPng] = await Promise.all([
    sharp(leftPath).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer(),
    sharp(rightPath).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer(),
    sharp(leftPath).resize(width, height, { fit: 'fill' }).removeAlpha().png().toBuffer(),
    sharp(rightPath).resize(width, height, { fit: 'fill' }).removeAlpha().png().toBuffer()
  ]);
  if (left.length !== right.length || left.length !== width * height * 3) {
    throw new Error(`Normalized render buffers diverge: ${left.length} vs ${right.length}.`);
  }
  const channelSumAbsolute = [0, 0, 0];
  const channelSumSquared = [0, 0, 0];
  const channelMaximum = [0, 0, 0];
  const pixelMaximumHistogram = new Uint32Array(256);
  const changedPixels = { at1: 0, at4: 0, at8: 0, at16: 0, at32: 0 };
  const difference = Buffer.alloc(left.length);
  const pixelCount = width * height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    let pixelMaximum = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const index = pixel * 3 + channel;
      const delta = Math.abs(left[index] - right[index]);
      channelSumAbsolute[channel] += delta;
      channelSumSquared[channel] += delta * delta;
      channelMaximum[channel] = Math.max(channelMaximum[channel], delta);
      pixelMaximum = Math.max(pixelMaximum, delta);
      difference[index] = Math.min(255, delta * differenceAmplification);
    }
    pixelMaximumHistogram[pixelMaximum] += 1;
    if (pixelMaximum > 1) changedPixels.at1 += 1;
    if (pixelMaximum > 4) changedPixels.at4 += 1;
    if (pixelMaximum > 8) changedPixels.at8 += 1;
    if (pixelMaximum > 16) changedPixels.at16 += 1;
    if (pixelMaximum > 32) changedPixels.at32 += 1;
  }
  const channels = ['red', 'green', 'blue'].map((name, channel) => ({
    name,
    meanAbsoluteError: channelSumAbsolute[channel] / pixelCount,
    rmse: Math.sqrt(channelSumSquared[channel] / pixelCount),
    maximumAbsoluteError: channelMaximum[channel]
  }));
  const metrics = {
    width,
    height,
    sourceDimensions: {
      left: { width: leftMetadata.width, height: leftMetadata.height },
      right: { width: rightMetadata.width, height: rightMetadata.height }
    },
    channels,
    meanAbsoluteError: channelSumAbsolute.reduce((sum, value) => sum + value, 0) / left.length,
    rmse: Math.sqrt(channelSumSquared.reduce((sum, value) => sum + value, 0) / left.length),
    pixelMaximumDelta: {
      p50: quantileFromHistogram(pixelMaximumHistogram, 0.5, pixelCount),
      p95: quantileFromHistogram(pixelMaximumHistogram, 0.95, pixelCount),
      p99: quantileFromHistogram(pixelMaximumHistogram, 0.99, pixelCount),
      maximum: pixelMaximumHistogram.findLastIndex((count) => count > 0)
    },
    changedPixelRatios: Object.fromEntries(Object.entries(changedPixels)
      .map(([key, count]) => [key, count / pixelCount]))
  };
  const checks = {
    rmse: metrics.rmse <= policy.maximumRmse,
    meanAbsoluteError: metrics.meanAbsoluteError <= policy.maximumMeanAbsoluteError,
    channelRmse: channels.every(({ rmse }) => rmse <= policy.maximumChannelRmse),
    channelMeanAbsoluteError: channels.every(({ meanAbsoluteError }) => (
      meanAbsoluteError <= policy.maximumChannelMeanAbsoluteError
    )),
    p95PixelDelta: metrics.pixelMaximumDelta.p95 <= policy.maximumP95PixelDelta,
    changedPixelsAt16: metrics.changedPixelRatios.at16 <= policy.maximumChangedPixelRatioAt16
  };
  await Promise.all([
    sharp({ create: { width: width * 2, height, channels: 3, background: '#20242a' } })
      .composite([{ input: leftPng, left: 0, top: 0 }, { input: rightPng, left: width, top: 0 }])
      .png().toFile(sideBySidePath),
    sharp(difference, { raw: { width, height, channels: 3 } }).png().toFile(differencePath)
  ]);
  return {
    passed: Object.values(checks).every(Boolean),
    policy,
    checks,
    metrics,
    artifacts: { sideBySidePath, differencePath, differenceAmplification }
  };
};
