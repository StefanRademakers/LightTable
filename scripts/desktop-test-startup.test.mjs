import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { packagedDesktopExecutable } from './desktop-test-startup.mjs';

test('resolves Forge packaged executables without a development bundle', () => {
  const workspace = path.resolve('D:/workspace/LightTable');
  assert.equal(
    packagedDesktopExecutable(workspace, 'win32', 'x64'),
    path.join(workspace, 'apps', 'desktop', 'out', 'LightTable-win32-x64', 'LightTable.exe')
  );
  assert.equal(
    packagedDesktopExecutable(workspace, 'darwin', 'arm64'),
    path.join(
      workspace, 'apps', 'desktop', 'out', 'LightTable-darwin-arm64',
      'LightTable.app', 'Contents', 'MacOS', 'LightTable'
    )
  );
});
