import { describe, expect, it } from 'vitest';
import { normalizeHiggsfieldModels, normalizeHiggsfieldWorkflow } from './higgsfieldDiscovery';

const video = {
  id: 'seedance_2_0', name: 'Seedance 2.0', output_type: 'video',
  parameters: [{ name: 'duration', type: 'number', min: 4, max: 15, default: 5 }, { name: 'generate_audio', type: 'bool', default: true }],
  medias: [{ type: 'image', roles: ['start_image', 'end_image'] }], aspect_ratios: ['16:9', '9:16']
};

describe('Higgsfield discovery', () => {
  it('projects image and video models into canonical modes', () => {
    expect(normalizeHiggsfieldModels({ items: [video, { id: 'nano', name: 'Nano', output_type: 'image', medias: [] }] }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'seedance_2_0', capabilities: ['text2video', 'frames2video'] }),
        expect.objectContaining({ id: 'nano', capabilities: ['text2image'] })
      ]));
  });

  it('maps video parameters, ratios and references without provider terms in shared roles', () => {
    const workflow = normalizeHiggsfieldWorkflow(video, 'seedance_2_0', 'frames2video');
    expect(workflow.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'prompt', role: 'prompt' }),
      expect.objectContaining({ key: 'duration', role: 'duration', minimum: 4, maximum: 15 }),
      expect.objectContaining({ key: 'generate_audio', role: 'sound' }),
      expect.objectContaining({ key: 'aspect_ratio', role: 'aspect-ratio' }),
      expect.objectContaining({ key: 'references', role: 'references' })
    ]));
  });
});
