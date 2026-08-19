import { describe, expect, it } from 'vitest';
import {
  createAdjustmentLayer,
  createImageDocument,
  createVectorLayer
} from '../../editor/document/documentTypes';
import { flattenImage } from '../../editor/document/documentCommands';
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
      mediaType: 'image/jpeg'
    });
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

  it('rejects source replacement without desktop authority or matching precision', () => {
    expect(planSourceFormatSave({
      document: document(),
      source: { name: 'portrait.png', type: 'image/png' },
      flatAdjustments: createDefaultAdjustments(),
      documentAdjustments: createDefaultAdjustments()
    })).toMatchObject({ blockers: expect.arrayContaining(['no-replaceable-source']) });

    const highBitDepth = document();
    highBitDepth.colorSettings.bitDepth = 16;
    expect(plan(highBitDepth)).toMatchObject({
      blockers: expect.arrayContaining(['unsupported-bit-depth'])
    });

    expect(planSourceFormatSave({
      document: document(),
      source: { ...source, name: 'portrait.png' },
      flatAdjustments: createDefaultAdjustments(),
      documentAdjustments: createDefaultAdjustments()
    })).toMatchObject({ blockers: expect.arrayContaining(['unsupported-source-format']) });
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
});
