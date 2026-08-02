const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerRpm } = require('@electron-forge/maker-rpm');
const { MakerDeb } = require('@electron-forge/maker-deb');
const { VitePlugin } = require('@electron-forge/plugin-vite');

module.exports = {
  // A separate output path lets CI and local verification package while a
  // previously built LightTable executable is still open on Windows.
  outDir: process.env.LIGHTTABLE_PACKAGE_OUT || 'out',
  packagerConfig: {
    // Forge's Vite plugin owns the package filter. The repository-level work/
    // queue is outside this app package root; the post-package boundary check
    // also inspects app.asar so a future packaging change cannot ship it.
    asar: true
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
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
