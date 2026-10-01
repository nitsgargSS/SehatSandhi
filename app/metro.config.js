// The app shares the website's data layer (../src/lib/*Api.ts, ../src/types)
// as source — one copy of every query and RPC call, no duplicated logic.
// Those files import `./supabase` and `./env`, which on the web read Vite's
// import.meta.env; here they are redirected to the app's own versions.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const WEB_SRC = path.resolve(__dirname, '../src')
const WEB_LIB = path.join(WEB_SRC, 'lib')
const APP_LIB = path.resolve(__dirname, 'src/lib')

config.watchFolders = [...(config.watchFolders ?? []), WEB_SRC]

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const from = context.originModulePath ?? ''
  // ./shrinkUpload builds PDFs in the browser (jspdf, canvas); the app has a stand-in.
  if (from.startsWith(WEB_LIB + path.sep) && ['./supabase', './env', './shrinkUpload'].includes(moduleName)) {
    return { type: 'sourceFile', filePath: path.join(APP_LIB, moduleName.slice(2) + '.ts') }
  }
  // '@web/…' → the website's src/…
  if (moduleName.startsWith('@web/')) {
    return context.resolveRequest(context, path.join(WEB_SRC, moduleName.slice(5)), platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
