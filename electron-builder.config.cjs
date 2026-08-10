/**
 * Packaging config.
 *
 * A JavaScript config rather than a `build` block in package.json because the
 * macOS half genuinely has to branch: with an Apple Developer ID in the
 * environment it produces a signed, notarized app; without one it produces the
 * best unsigned app macOS will still open. Expressing that as static JSON is
 * not possible, and getting it wrong is not obvious until someone downloads the
 * result and is told the app is damaged.
 *
 * What ships:
 *   app.asar            electron/ — the shell. Small, rarely changes.
 *   resources/payload/  web/, server/, data/ — the app itself, plain files.
 *
 * The payload is deliberately NOT inside the asar. It is the thing the updater
 * replaces, so the running copy and the downloaded copy have to be the same
 * shape: an ordinary directory the server can be started from.
 */

const { existsSync } = require('node:fs')

// A Developer ID in the environment is the only thing that distinguishes a
// release build from a local one. CI sets it from repository secrets; a laptop
// normally has none, and that path has to work too.
const signed = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)
const notarize = signed && Boolean(process.env.APPLE_TEAM_ID || process.env.APPLE_API_ISSUER)

const NO_JUNK = ['**/*', '!**/.DS_Store', '!**/Thumbs.db']

module.exports = {
  appId: 'com.emreyalcin.deutsch-lernen',
  productName: 'Deutsch Lernen',
  copyright: `Copyright © ${new Date().getFullYear()} M. Emre Yalcin`,
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',

  directories: { output: 'dist', buildResources: 'build' },

  // The shell only. Everything the app displays comes from extraResources.
  asar: true,
  // Written as "everything, minus" rather than as an allowlist of the two
  // things wanted. An allowlist of ['electron/**/*', 'package.json'] silently
  // dropped package.json from the archive, and Electron will not start without
  // it. Subtracting is the form electron-builder is reliable about.
  //
  // Everything excluded here that the app still needs — web/, server/, data/ —
  // is shipped by extraResources below, as plain files rather than inside the
  // archive.
  files: [
    '**/*',
    '!web/**', '!server/**', '!data/**', '!cache/**',
    '!tools/**', '!build/**', '!dist/**', '!.github/**',
    '!start.sh', '!*.md', '!electron-builder.config.cjs',
    '!**/.DS_Store',
  ],

  extraResources: [
    { from: 'web', to: 'payload/web', filter: NO_JUNK },
    { from: 'server', to: 'payload/server', filter: NO_JUNK },
    // Your own words live in userData, never in the bundle — shipping the
    // build machine's copy would hand every user someone else's vocabulary.
    { from: 'data/vocab', to: 'payload/data/vocab', filter: [...NO_JUNK, '!00-my-words.json'] },
    { from: 'data/grammar', to: 'payload/data/grammar', filter: NO_JUNK },
    // Not decoration: this is the "type": "module" marker. Without a
    // package.json above it, Node refuses to load server/server.js at all.
    //
    // A dedicated two-line file rather than the project's own package.json,
    // which lists build scripts and devDependencies that mean nothing here —
    // and which, copied from here, made electron-builder omit the real
    // package.json from app.asar and produce an app that would not start.
    { from: 'build/payload-package.json', to: 'payload/package.json' },
  ],

  mac: {
    category: 'public.app-category.education',
    icon: 'build/icon.icns',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    // Without an identity, electron-builder signs nothing at all and ships a
    // bundle whose only signature is the linker's ad-hoc one from Electron's
    // own build. macOS reads that as a *broken* signature and refuses with
    // "the app is damaged", which has no "open anyway" — a dead end.
    // "-" means a real ad-hoc signature over this bundle. Still unnotarized,
    // so still a warning, but one the user can get past.
    identity: signed ? undefined : '-',
    // Hardened runtime is required for notarization and incompatible with an
    // ad-hoc signature unless library validation is disabled — so it is only
    // turned on for builds that are actually going to be notarized.
    hardenedRuntime: notarize,
    gatekeeperAssess: false,
    ...(notarize ? {
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      notarize: process.env.APPLE_TEAM_ID ? { teamId: process.env.APPLE_TEAM_ID } : true,
    } : {}),
  },

  dmg: {
    // The one instruction the window needs to give: drag it across.
    contents: [
      { x: 140, y: 200, type: 'file' },
      { x: 400, y: 200, type: 'link', path: '/Applications' },
    ],
  },

  win: {
    icon: existsSync('build/icon.ico') ? 'build/icon.ico' : 'build/icon.png',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
  },

  nsis: {
    // Per-user, so it never asks for an administrator password, and a real
    // installer page rather than a silent one-click that leaves people unsure
    // whether anything happened.
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    // Study history lives in userData and is never touched by uninstalling.
    deleteAppDataOnUninstall: false,
  },

  linux: {
    icon: 'build/icon.png',
    category: 'Education',
    synopsis: 'German A0–A2 study app with spaced repetition',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
  },

  publish: [{ provider: 'github', owner: 'm-emre-yalcin', repo: 'deutsch-lernen' }],
}
