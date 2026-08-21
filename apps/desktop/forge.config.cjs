const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerRpm } = require('@electron-forge/maker-rpm');
const { MakerDeb } = require('@electron-forge/maker-deb');
const { VitePlugin } = require('@electron-forge/plugin-vite');
const fs = require('node:fs');
const path = require('node:path');

const localAiProviderPath = path.resolve(__dirname, '../local-ai-provider');
const localAiRuntimePath = path.resolve(__dirname, '../../.referenceCode/local-ai-runtime');
const iconRoot = path.resolve(__dirname, '../../icon');
const windowsIconPath = path.join(iconRoot, 'logo_emblem_ico.ico');
const portableIconPath = path.join(iconRoot, 'logo_emblem.png');
const localAiResources = [localAiProviderPath];
if (fs.existsSync(localAiRuntimePath)) localAiResources.push(localAiRuntimePath);

const macNotarize = process.env.LIGHTTABLE_MAC_NOTARIZE === 'true'
  ? (() => {
      const { APPLE_ID: appleId, APPLE_APP_PASSWORD: appleIdPassword, APPLE_TEAM_ID: teamId } = process.env;
      if (!appleId || !appleIdPassword || !teamId) {
        throw new Error('macOS notarization requires APPLE_ID, APPLE_APP_PASSWORD and APPLE_TEAM_ID.');
      }
      return { tool: 'notarytool', appleId, appleIdPassword, teamId };
    })()
  : undefined;

const macSign = process.env.LIGHTTABLE_MAC_SIGN_IDENTITY
  ? { identity: process.env.LIGHTTABLE_MAC_SIGN_IDENTITY }
  : process.platform === 'darwin'
    // Apple Silicon requires every executable to carry a valid code
    // signature. An ad-hoc signature has no publisher identity and cannot be
    // notarized, but it produces a runnable private-testing build without an
    // Apple Developer Program membership.
    ? { identity: '-', identityValidation: false }
    : undefined;

if (macNotarize && !process.env.LIGHTTABLE_MAC_SIGN_IDENTITY) {
  throw new Error('macOS notarization requires a Developer ID Application signing identity.');
}

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
    icon: process.platform === 'win32' ? windowsIconPath : portableIconPath,
    appBundleId: 'com.mediavibe.lighttable',
    appCategoryType: 'public.app-category.graphics-design',
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'LightTable bitmap image',
          CFBundleTypeRole: 'Editor',
          LSHandlerRank: 'Alternate',
          CFBundleTypeExtensions: ['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'tif', 'tiff'],
          LSItemContentTypes: ['public.jpeg', 'public.png', 'org.webmproject.webp', 'public.tiff']
        }
      ]
    },
    appCopyright: 'Copyright (c) Mediavibe Holding B.V.',
    // The provider service is an independent loopback process, not renderer or
    // MCP code. Models remain replaceable user data and are installed outside
    // the application bundle; the small native runtime is included when a
    // platform build has staged it in .referenceCode/local-ai-runtime.
    extraResource: [...localAiResources, windowsIconPath, portableIconPath],
    osxSign: macSign,
    osxNotarize: macNotarize
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: 'LightTable', setupIcon: windowsIconPath }),
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
