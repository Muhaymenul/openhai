'use strict';

module.exports = {
  appId: 'org.openhai.jiaoyan.desktop',
  productName: '教研阅记',
  executableName: 'JiaoyanDesktop',
  artifactName: 'Jiaoyan-Desktop-${version}-Setup-${arch}.${ext}',
  directories: { output: 'dist', buildResources: 'assets' },
  electronDist: 'node_modules/electron/dist',
  electronVersion: '45.3.2',
  asar: true,
  files: ['src/**', 'assets/logo.png', '使用说明.html', 'package.json'],
  extraResources: [
    { from: '安装版使用说明.html', to: '安装版使用说明.html' },
    { from: 'assets/logo.png', to: 'assets/logo.png' },
    { from: 'assets/Papernook-LICENSE.txt', to: 'licenses/Papernook-LICENSE.txt' },
    { from: 'assets/THIRD_PARTY_NOTICES.txt', to: 'licenses/THIRD_PARTY_NOTICES.txt' },
  ],
  npmRebuild: false,
  publish: null,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/icon.ico',
    // This local pilot is unsigned; do not search the user's certificate store.
    signExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: '教研阅记',
    uninstallDisplayName: '教研阅记桌面版',
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
    installerLanguages: ['zh_CN', 'en_US'],
    displayLanguageSelector: false,
    license: 'assets/安装须知.txt',
  },
};
