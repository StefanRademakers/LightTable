import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIGHTTABLE_COMMAND_SCHEMAS,
  validateJsonSchemaValue
} from '@lighttable/command-contract';
import { LIGHTTABLE_ARTIST_GUIDES } from '../src/artistGuides.mjs';

const jsonExamples = (guide) => [...guide.text.matchAll(/```json\n([\s\S]*?)\n```/gu)]
  .map((match) => JSON.parse(match[1]));

test('artist guides remain bounded, unique and versionable MCP resources', () => {
  assert.equal(LIGHTTABLE_ARTIST_GUIDES.length, 4);
  assert.equal(new Set(LIGHTTABLE_ARTIST_GUIDES.map(({ id }) => id)).size, LIGHTTABLE_ARTIST_GUIDES.length);
  assert.equal(new Set(LIGHTTABLE_ARTIST_GUIDES.map(({ uri }) => uri)).size, LIGHTTABLE_ARTIST_GUIDES.length);
  for (const guide of LIGHTTABLE_ARTIST_GUIDES) {
    assert.match(guide.uri, /^lighttable:\/\/guides\/[a-z-]+$/u);
    assert.ok(Number.isInteger(guide.version) && guide.version > 0);
    assert.ok(guide.text.length > 100 && guide.text.length < 12_000);
  }
});

test('artist guide command examples conform to the shared command contract', () => {
  const cases = [
    ['efficient-batching', 'command.batch'],
    ['native-vector-paths', 'vector.create']
  ];
  for (const [guideId, command] of cases) {
    const guide = LIGHTTABLE_ARTIST_GUIDES.find(({ id }) => id === guideId);
    assert.ok(guide, `Missing ${guideId} guide.`);
    const examples = jsonExamples(guide);
    assert.ok(examples.length > 0, `${guideId} has no JSON example.`);
    for (const example of examples) {
      assert.deepEqual(validateJsonSchemaValue(LIGHTTABLE_COMMAND_SCHEMAS[command].input, example), {
        valid: true, issues: []
      });
    }
  }
});

test('design guidance requires compact layers and explicit multi-document inspection', () => {
  const onboarding = LIGHTTABLE_ARTIST_GUIDES.find(({ id }) => id === 'artist-onboarding');
  const design = LIGHTTABLE_ARTIST_GUIDES.find(({ id }) => id === 'design-pass');
  assert.match(onboarding.text, /Reuse one vector layer/u);
  assert.match(design.text, /reusing layerId/u);
  assert.match(design.text, /each requested asset by stable documentId/u);
  assert.match(design.text, /dozens of "Circle" layers/u);
  assert.match(design.text, /initial settings directly to adjustment\.create/u);
  assert.match(design.text, /Gradient Map settings carry bounded color stops/u);
});
