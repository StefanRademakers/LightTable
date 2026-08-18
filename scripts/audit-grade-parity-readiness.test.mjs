import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditGradeParityReadiness } from './audit-grade-parity-readiness.mjs';

test('requires hash-correct reports with identical cases on every source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lt-grade-readiness-'));
  const workspace = path.join(root, 'workspace');
  const externalRoot = path.join(root, 'corpus');
  try {
    await Promise.all([
      mkdir(path.join(workspace, 'scripts'), { recursive: true }),
      mkdir(path.join(externalRoot, 'captures', 'light', 'target', 'camera-raw'), { recursive: true }),
      mkdir(path.join(externalRoot, 'captures', 'light', 'target', 'lighttable'), { recursive: true })
    ]);
    const manifest = Buffer.from('{"schema":1,"section":"light","controls":[]}\n');
    const manifestHash = createHash('sha256').update(manifest).digest('hex');
    await Promise.all([
      writeFile(path.join(workspace, 'scripts', 'grade-light-parity-cases.json'), manifest),
      writeFile(path.join(externalRoot, 'inventory.json'), JSON.stringify({
        sources: [{ id: 'target', sha256: 'source-hash' }]
      }))
    ]);
    const report = {
      schema: 3,
      section: 'light',
      sourceEvidence: { sha256: 'source-hash' },
      caseManifestSha256: manifestHash,
      cases: [{ id: 'neutral' }]
    };
    await Promise.all([
      writeFile(path.join(externalRoot, 'captures', 'light', 'target', 'camera-raw', 'capture-report.json'), JSON.stringify(report)),
      writeFile(path.join(externalRoot, 'captures', 'light', 'target', 'lighttable', 'capture-report.json'), JSON.stringify(report))
    ]);

    const result = await auditGradeParityReadiness({
      workspace,
      externalRoot,
      sections: [{ id: 'light', manifest: 'grade-light-parity-cases.json' }]
    });
    assert.equal(result.complete, true);
    assert.equal(result.sections[0].status, 'complete');
    assert.equal(result.sections[0].cameraRawValid, 1);
    assert.equal(result.sections[0].lightTableValid, 1);
    assert.equal(result.sections[0].compatible, 1);
    assert.equal(result.sections[0].sources[0].compatible, true);

    const stale = { ...report, caseManifestSha256: 'stale' };
    await writeFile(
      path.join(externalRoot, 'captures', 'light', 'target', 'camera-raw', 'capture-report.json'),
      JSON.stringify(stale)
    );
    const invalid = await auditGradeParityReadiness({
      workspace,
      externalRoot,
      sections: [{ id: 'light', manifest: 'grade-light-parity-cases.json' }]
    });
    assert.equal(invalid.complete, false);
    assert.equal(invalid.sections[0].sources[0].cameraRaw, 'stale-case-manifest');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('representative coverage requires the named sources rather than any matching count', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lt-grade-readiness-target-'));
  const workspace = path.join(root, 'workspace');
  const externalRoot = path.join(root, 'corpus');
  const definition = {
    id: 'curves',
    manifest: 'grade-curves-parity-cases.json',
    requiredSources: ['ramp', 'portrait']
  };
  try {
    await Promise.all([
      mkdir(path.join(workspace, 'scripts'), { recursive: true }),
      mkdir(externalRoot, { recursive: true })
    ]);
    const manifest = Buffer.from('{"schema":1,"section":"curves","controls":[]}\n');
    const manifestHash = createHash('sha256').update(manifest).digest('hex');
    const sources = ['ramp', 'portrait', 'optional'].map((id) => ({ id, sha256: `${id}-hash` }));
    await Promise.all([
      writeFile(path.join(workspace, 'scripts', definition.manifest), manifest),
      writeFile(path.join(externalRoot, 'inventory.json'), JSON.stringify({ sources }))
    ]);
    const writePair = async (source) => {
      const report = {
        schema: 3,
        section: 'curves',
        sourceEvidence: { sha256: source.sha256 },
        caseManifestSha256: manifestHash,
        cases: [{ id: 'neutral' }]
      };
      const rootForSource = path.join(externalRoot, 'captures', 'curves', source.id);
      await Promise.all(['camera-raw', 'lighttable'].map(async (renderer) => {
        const folder = path.join(rootForSource, renderer);
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, 'capture-report.json'), JSON.stringify(report));
      }));
    };

    await Promise.all([writePair(sources[0]), writePair(sources[2])]);
    const missingNamedSource = await auditGradeParityReadiness({
      workspace,
      externalRoot,
      sections: [definition]
    });
    assert.equal(missingNamedSource.complete, false);
    assert.equal(missingNamedSource.sections[0].status, 'partial');
    assert.equal(missingNamedSource.sections[0].requiredCompatible, 1);

    await writePair(sources[1]);
    await rm(path.join(externalRoot, 'captures', 'curves', 'optional'), { recursive: true, force: true });
    const representative = await auditGradeParityReadiness({
      workspace,
      externalRoot,
      sections: [definition]
    });
    assert.equal(representative.complete, true);
    assert.equal(representative.sections[0].status, 'representative-complete');
    assert.equal(representative.sections[0].requiredCompatible, 2);
    assert.equal(representative.sections[0].coverageTarget, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dedicated native evidence distinguishes an open oracle from an intentional difference', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lt-grade-readiness-native-'));
  const workspace = path.join(root, 'workspace');
  const externalRoot = path.join(root, 'corpus');
  try {
    await Promise.all([
      mkdir(path.join(workspace, 'scripts'), { recursive: true }),
      mkdir(externalRoot, { recursive: true })
    ]);
    await writeFile(path.join(externalRoot, 'inventory.json'), JSON.stringify({ sources: [] }));
    const definitions = [
      {
        id: 'point-color', manifest: 'grade-point-color-parity-cases.json',
        dedicatedEvidence: true, evidenceStatus: 'native-complete-camera-raw-open'
      },
      {
        id: 'look-profile', manifest: 'grade-look-profile-parity-cases.json',
        dedicatedEvidence: true, evidenceStatus: 'intentional-difference'
      }
    ];
    for (const definition of definitions) {
      const manifest = Buffer.from(JSON.stringify({ schema: 1, section: definition.id }));
      const manifestHash = createHash('sha256').update(manifest).digest('hex');
      await writeFile(path.join(workspace, 'scripts', definition.manifest), manifest);
      const evidenceDirectory = path.join(
        externalRoot, 'captures', definition.id, 'native'
      );
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(path.join(evidenceDirectory, 'capture-report.json'), JSON.stringify({
        section: definition.id,
        caseManifestSha256: manifestHash,
        packagedDesktop: true,
        passed: true
      }));
    }
    const report = await auditGradeParityReadiness({ workspace, externalRoot, sections: definitions });
    assert.equal(report.sections[0].status, 'native-complete-camera-raw-open');
    assert.equal(report.sections[1].status, 'intentional-difference');
    assert.equal(report.complete, false, 'the open Point Color oracle remains an honest blocker');

    const lookOnly = await auditGradeParityReadiness({
      workspace, externalRoot, sections: [definitions[1]]
    });
    assert.equal(lookOnly.complete, true, 'an explicit semantic difference is a valid terminal state');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
