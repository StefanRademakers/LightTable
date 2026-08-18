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
