import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { compareRenderEvidence } from './render-comparison-evidence.mjs';

const policy = {
  maximumRmse: 10,
  maximumMeanAbsoluteError: 8,
  maximumChannelRmse: 12,
  maximumChannelMeanAbsoluteError: 10,
  maximumP95PixelDelta: 12,
  maximumChangedPixelRatioAt16: 0.1
};

test('retains multidimensional metrics and both visual artifacts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lighttable-render-evidence-'));
  try {
    const left = path.join(directory, 'left.png');
    const right = path.join(directory, 'right.png');
    const sideBySidePath = path.join(directory, 'side.png');
    const differencePath = path.join(directory, 'difference.png');
    await Promise.all([
      sharp({ create: { width: 10, height: 10, channels: 3, background: '#202020' } }).png().toFile(left),
      sharp({ create: { width: 10, height: 10, channels: 3, background: '#222020' } }).png().toFile(right)
    ]);
    const evidence = await compareRenderEvidence({ leftPath: left, rightPath: right,
      width: 10, height: 10, sideBySidePath, differencePath, policy });
    assert.equal(evidence.passed, true);
    assert.equal(evidence.metrics.channels.length, 3);
    assert.equal(evidence.metrics.channels[0].meanAbsoluteError, 2);
    assert.equal(evidence.metrics.channels[1].meanAbsoluteError, 0);
    assert.equal(evidence.metrics.pixelMaximumDelta.p95, 2);
    assert.equal((await sharp(sideBySidePath).metadata()).width, 20);
    assert.equal((await sharp(differencePath).metadata()).width, 10);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails each declared image policy dimension independently', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lighttable-render-policy-'));
  try {
    const left = path.join(directory, 'left.png');
    const right = path.join(directory, 'right.png');
    await Promise.all([
      sharp({ create: { width: 4, height: 4, channels: 3, background: '#000000' } }).png().toFile(left),
      sharp({ create: { width: 4, height: 4, channels: 3, background: '#404040' } }).png().toFile(right)
    ]);
    const evidence = await compareRenderEvidence({ leftPath: left, rightPath: right,
      width: 4, height: 4, sideBySidePath: path.join(directory, 'side.png'),
      differencePath: path.join(directory, 'difference.png'), policy });
    assert.equal(evidence.passed, false);
    assert.deepEqual(evidence.checks, {
      rmse: false,
      meanAbsoluteError: false,
      channelRmse: false,
      channelMeanAbsoluteError: false,
      p95PixelDelta: false,
      changedPixelsAt16: false
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects aspect-ratio mismatches instead of stretching them into a score', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lighttable-render-aspect-'));
  try {
    const left = path.join(directory, 'left.png');
    const right = path.join(directory, 'right.png');
    await Promise.all([
      sharp({ create: { width: 10, height: 10, channels: 3, background: '#000000' } }).png().toFile(left),
      sharp({ create: { width: 20, height: 10, channels: 3, background: '#000000' } }).png().toFile(right)
    ]);
    await assert.rejects(compareRenderEvidence({ leftPath: left, rightPath: right,
      width: 10, height: 10, sideBySidePath: path.join(directory, 'side.png'),
      differencePath: path.join(directory, 'difference.png'), policy }), /aspect ratios diverge/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
