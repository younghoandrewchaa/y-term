const release = process.env.Y_TERM_RELEASE === '1';
const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD;
const notarization = process.env.APPLE_ID ? {
  appleId: process.env.APPLE_ID,
  appleIdPassword: applePassword,
  teamId: process.env.APPLE_TEAM_ID,
} : { keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE || 'm-note' };
if (release && process.env.APPLE_ID && (!applePassword || !process.env.APPLE_TEAM_ID)) {
  throw new Error('APPLE_ID requires APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.');
}

module.exports = {
  packagerConfig: {
    name: 'Y-Term',
    icon: 'assets/icon.icns',
    ...(process.env.ELECTRON_ZIP_DIR ? { electronZipDir: process.env.ELECTRON_ZIP_DIR } : {}),
    executableName: 'Y-Term',
    appBundleId: 'dev.youngho.y-term',
    appCategoryType: 'public.app-category.developer-tools',
    // node-pty needs both its native binding and its executable spawn-helper.
    asar: { unpack: '**/node-pty/**' },
    ignore: [/^\/src($|\/)/, /^\/tests($|\/)/, /^\/scripts($|\/)/, /^\/docs($|\/)/, /^\/test-results($|\/)/],
    ...(release || process.env.APPLE_SIGN_IDENTITY ? {
      osxSign: process.env.APPLE_SIGN_IDENTITY ? { identity: process.env.APPLE_SIGN_IDENTITY } : {},
      ...(release || (process.env.APPLE_ID && applePassword && process.env.APPLE_TEAM_ID) ? {
        osxNotarize: notarization,
      } : {}),
    } : {}),
  },
  rebuildConfig: { onlyModules: ['node-pty'] },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: (arch) => ({
        name: `Y-Term-darwin-${arch}-${require('./package.json').version}`,
        format: 'ULFO',
        icon: 'assets/icon.icns',
      }),
    },
  ],
};
