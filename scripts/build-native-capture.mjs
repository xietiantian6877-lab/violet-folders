import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Native desktop capture requires Windows x64.')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = join(root, 'native', 'desktop-capture')
const output = join(directory, 'build')
mkdirSync(output, { recursive: true })
const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
const installation = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }).stdout?.trim()
if (!installation) throw new Error('MSVC x64 build tools were not found.')
const msvcRoot = join(installation, 'VC', 'Tools', 'MSVC')
const msvcVersion = readdirSync(msvcRoot).filter(item => statSync(join(msvcRoot, item)).isDirectory()).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
const msvc = join(msvcRoot, msvcVersion)
const kits = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10')
const sdkVersion = readdirSync(join(kits, 'Include')).filter(item => ['cppwinrt/winrt/base.h', 'shared/dxgi1_2.h', 'um/d3d11.h'].every(header => existsSync(join(kits, 'Include', item, header)))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
if (!sdkVersion) throw new Error('Windows 10 SDK with C++/WinRT headers was not found.')
const cache = join(process.env.LOCALAPPDATA, 'node-gyp', 'Cache')
const findHeaders = () => {
  const cached = existsSync(cache) ? readdirSync(cache).sort((a,b) => b.localeCompare(a,undefined,{numeric:true})).map(version => join(cache, version)) : []
  return [process.env.NODE_HEADERS_DIR, ...cached].filter(Boolean)
    .find(candidate => existsSync(join(candidate, 'include', 'node', 'node_api.h')) && existsSync(join(candidate, 'x64', 'node.lib')))
}
let headers = findHeaders()
if (!headers) {
  const installHeaders = spawnSync(process.execPath, [join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'), 'install', '--ensure', '--devdir', cache], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (installHeaders.status !== 0) throw new Error('Unable to install Node headers for native capture.')
  headers = findHeaders()
}
if (!headers) throw new Error('Node headers/node.lib were not found. Set NODE_HEADERS_DIR to a node-gyp headers cache directory.')
const include = [join(msvc, 'include'), ...['ucrt', 'um', 'shared', 'winrt', 'cppwinrt'].map(part => join(kits, 'Include', sdkVersion, part)), join(headers, 'include', 'node')]
const lib = [join(msvc, 'lib', 'x64'), ...['ucrt', 'um'].map(part => join(kits, 'Lib', sdkVersion, part, 'x64')), join(headers, 'x64')]
const compiler = join(msvc, 'bin', 'Hostx64', 'x64', 'cl.exe')
const args = ['/nologo', '/std:c++20', '/EHsc', '/MT', '/O2', '/LD', '/DWINVER=0x0A00', '/D_WIN32_WINNT=0x0A00', '/DNAPI_VERSION=8', '/DNODE_GYP_MODULE_NAME=desktop_capture', ...include.map(path => `/I${path}`), join(directory, 'desktop_capture.cc'), `/Fo${join(output, 'desktop_capture.obj')}`, '/link', `/OUT:${join(output, 'desktop_capture.node')}`, '/DELAYLOAD:node.exe', ...lib.map(path => `/LIBPATH:${path}`), 'node.lib', 'delayimp.lib', 'd3d11.lib', 'dxgi.lib', 'windowsapp.lib', 'runtimeobject.lib', 'user32.lib', 'dwmapi.lib']
const build = spawnSync(compiler, args, { cwd: output, stdio: 'inherit', windowsHide: true })
if (build.status !== 0) process.exit(build.status || 1)
console.log(`Built ${join(output, 'desktop_capture.node')}`)
