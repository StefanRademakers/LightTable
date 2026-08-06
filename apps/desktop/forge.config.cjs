const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerRpm } = require('@electron-forge/maker-rpm');
const { MakerDeb } = require('@electron-forge/maker-deb');
const { VitePlugin } = require('@electron-forge/plugin-vite');

const macNotarize = process.env.LIGHTTABLE_MAC_NOTARIZE === 'true'
  ? (() => {
      const { APPLE_ID: appleId, APPLE_APP_PASSWORD: appleIdPassword, APPLE_TEAM_ID: teamId } = process.env;
      if (!appleId || !appleIdPassword || !teamId) {
        throw new Error('macOS notarization requires APPLE_ID, APPLE_APP_PASSWORD and APPLE_TEAM_ID.');
      }
      return { tool: 'notarytool', appleId, appleIdPassword, teamId };
    })()
  : undefined;

module.exports = {
  // A separate output path lets CI and local verification package while a
  // previously built LightTable executable is still open on Windows.
  outDir: process.env.LIGHTTABLE_PACKAGE_OUT || 'out',
  packagerConfig: {
    // Forge's Vite plugin owns the package filter. The repository-level work/
    // queue is outside this app package root; the post-package boundary check
    // also inspects app.asar so a future packaging change cannot ship it.
    asar: true,
    executableName: 'LightTable',
    appBundleId: 'com.mediavibe.lighttable',
    appCategoryType: 'public.app-category.graphics-design',
    osxSign: process.env.LIGHTTABLE_MAC_SIGN_IDENTITY
      ? { identity: process.env.LIGHTTABLE_MAC_SIGN_IDENTITY }
      : undefined,
    osxNotarize: macNotarize
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: 'LightTable' }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({})
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main'
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload'
        }
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts'
        }
      ],
      concurrent: false
    })
  ]
};
