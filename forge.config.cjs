module.exports = {
  packagerConfig: {
    name: 'Y-Term',
    ...(process.env.ELECTRON_ZIP_DIR ? { electronZipDir: process.env.ELECTRON_ZIP_DIR } : {}),
    executableName: 'Y-Term',
    appBundleId: 'dev.youngho.y-term',
    appCategoryType: 'public.app-category.developer-tools',
    // node-pty needs both its native binding and its executable spawn-helper.
    asar: { unpack: '**/node-pty/**' },
    ignore: [/^\/src($|\/)/, /^\/tests($|\/)/, /^\/scripts($|\/)/, /^\/docs($|\/)/, /^\/test-results($|\/)/],
    ...(process.env.APPLE_SIGN_IDENTITY ? {
      osxSign: { identity: process.env.APPLE_SIGN_IDENTITY },
      ...(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID ? {
        osxNotarize: {
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
          teamId: process.env.APPLE_TEAM_ID,
        },
      } : {}),
    } : {}),
  },
  rebuildConfig: { onlyModules: ['node-pty'] },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin'] }],
};
