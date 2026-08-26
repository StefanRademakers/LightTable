import { describe, expect, it } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import {
  createAdjustmentLayer,
  createImageDocument,
  createVectorLayer
} from '../../editor/document/documentTypes';
import {
  createTextLayer,
  flattenImage,
  mergeLayerDown
} from '../../editor/document/documentCommands';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import { planSourceFormatSave } from './planSourceFormatSave';

const document = () => {
  const result = createImageDocument('portrait.jpg', 640, 480, 'source');
  result.colorSettings.bitDepth = 8;
  return result;
};

const source = {
  name: 'portrait.jpg',
  type: 'image/jpeg',
  sourcePath: 'D:\\images\\portrait.jpg'
};

const plan = (image = document()) => planSourceFormatSave({
  document: image,
  source,
  flatAdjustments: createDefaultAdjustments(),
  documentAdjustments: createDefaultAdjustments()
});

describe('planSourceFormatSave', () => {
  it('allows one neutral full-canvas raster to replace its JPEG source', () => {
    expect(plan()).toEqual({
      kind: 'replace-source',
      format: 'jpeg',
      sourcePath: source.sourcePath,
      sourceName: source.name,
      mediaType: 'image/jpeg',
      bitDepth: 8
    });
  });

  it.each([
    ['webp', 'image/webp', 'portrait.webp'],
    ['tiff', 'image/tiff', 'portrait.tif'],
    ['tiff', 'image/tiff', 'portrait.tiff']
  ] as const)('allows an eligible 8-bit %s source roundtrip', (format, mediaType, name) => {
    expect(planSourceFormatSave({
      document: document(),
      source: { name, type: mediaType, sourcePath: `D:\\images\\${name}` },
      flatAdjustments: createDefaultAdjustments(),
      documentAdjustments: createDefaultAdjustments()
    })).toMatchObject({ kind: 'replace-source', format, mediaType, bitDepth: 8 });
  });

  it('allows an opened 8-bit PNG to save back as an 8-bit PNG', () => {
    expect(planSourceFormatSave({
      document: document(),
      source: { name: 'portrait.png', type: 'image/png', sourcePath: 'D:\\images\\portrait.png' },
      flatAdjustments: createDefaultAdjustments(),
      documentAdjustments: createDefaultAdjustments()
    })).toMatchObject({ kind: 'replace-source', format: 'png', mediaType: 'image/png' });
  });

  it('fails closed while editable layer or grade semantics remain', () => {
    const layered = document();
    layered.layers.push(createVectorLayer([], 'Shape'));
    expect(plan(layered)).toMatchObject({
      kind: 'lighttable-document',
      blockers: expect.arrayContaining(['document-structure'])
    });

    const grade = createDefaultAdjustments();
    grade.exposureEV = 1;
    expect(planSourceFormatSave({
      document: document(), source,
      flatAdjustments: grade,
      documentAdjustments: createDefaultAdjustments()
    })).toMatchObject({
      kind: 'lighttable-document',
      blockers: expect.arrayContaining(['live-document-processing'])
    });
  });

  it('becomes eligible after live adjustment layers are flattened into pixels', () => {
    const layered = document();
    const grade = createDefaultAdjustments();
    grade.exposureEV = 1;
    layered.layers.push(createAdjustmentLayer(
      createAdjustmentStackFromBasicAdjustments(grade),
      'Grade',
      'grade'
    ));
    expect(plan(layered)).toMatchObject({ kind: 'lighttable-document' });
    expect(plan(flattenImage(layered))).toMatchObject({ kind: 'replace-source', format: 'jpeg' });
  });

  it.each([
    ['jpeg', 'image/jpeg', 'portrait.jpg'],
    ['png', 'image/png', 'portrait.png'],
    ['webp', 'image/webp', 'portrait.webp'],
    ['tiff', 'image/tiff', 'portrait.tiff']
  ] as const)(
    'allows an opened %s to replace its source after text is merged',
    (format, type, name) => {
    const withText = createTextLayer(document(), createDefaultTextLayerData());
    withText.assets.fonts.push({
      assetId: 'font-inter-regular',
      faceIndex: 0,
      fingerprintSha256: 'a'.repeat(64),
      source: 'system',
      container: 'sfnt',
      outline: 'truetype',
      postScriptName: 'Inter-Regular',
      embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false },
      familyNames: ['Inter'],
      styleName: 'Regular',
      weight: 400,
      stretch: 100,
      italic: false,
      byteLength: 1024
    });
    const flattened = mergeLayerDown(withText, withText.activeLayerId!);

    expect(flattened.layers).toHaveLength(1);
    expect(flattened.layers[0]).toMatchObject({ type: 'raster' });
    expect(planSourceFormatSave({
      document: flattened,
      source: { name, type, sourcePath: `D:\\images\\${name}` },
      flatAdjustments: createDefaultAdjustments(),
      documentAdjustments: createDefaultAdjustments()
    })).toMatchObject({ kind: 'replace-source', format });
    }
  );

  it('rejects source replacement without desktop authority or a matching format', () => {
    expect(planSourceFormatSave({
      document: document(),
      source: { name: 'portrait.png', type: 'image/png' },
      flatAdjustments: createDefaultAdjustments(),
      documentAdjustments: createDefaultAdjustments()
    })).toMatchObject({ blockers: expect.arrayContaining(['no-replaceable-source']) });

    const highBitDepth = document();
    highBitDepth.colorSettings.bitDepth = 16;
    expect(plan(highBitDepth)).toMatchObject({
      kind: 'replace-source', format: 'jpeg', bitDepth: 8
    });

    expect(planSourceFormatSave({
      document: document(),
      source: { ...source, name: 'portrait.png' },
      flatAdjustments: createDefaultAdjustments(),
      documentAdjustments: createDefaultAdjustments()
    })).toMatchObject({ blockers: expect.arrayContaining(['unsupported-source-format']) });
  });

  it.each([
    ['png', 'image/png', 'portrait.png'],
    ['tiff', 'image/tiff', 'portrait.tiff']
  ] as const)('allows a flat 16-bit %s through the precision save route', (format, type, name) => {
    const precision = document();
    precision.colorSettings.bitDepth = 16;
    expect(planSourceFormatSave({
      document: precision,
      source: { name, type, sourcePath: `D:\\images\\${name}` },
      flatAdjustments: createDefaultAdjustments(),
      documentAdjustments: createDefaultAdjustments()
    })).toMatchObject({ kind: 'replace-source', format, bitDepth: 16 });
  });

  it('treats masks, transforms and retained metadata as live semantics', () => {
    const transformed = document();
    const layer = transformed.layers[0]!;
    if (layer.type === 'raster') layer.transform.tx = 2;
    transformed.guides.push({ id: 'guide', orientation: 'vertical', position: 10 });
    expect(plan(transformed)).toMatchObject({
      blockers: expect.arrayContaining(['live-layer-semantics', 'document-metadata'])
    });
  });

  it('does not treat pixel-editing locks as bitmap content', () => {
    const locked = document();
    locked.layers[0]!.locks.pixels = true;
    expect(plan(locked)).toMatchObject({ kind: 'replace-source', format: 'jpeg' });
  });
});
