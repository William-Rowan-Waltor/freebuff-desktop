// Freebuff Desktop — Electron shell.
//
// Spawns the Next.js server (the production standalone build when present,
// otherwise `next dev`) on a free local port and opens it in a native window,
// so the app runs as a real desktop application: double-click the installed
// app, no Docker or browser tab needed.
//
// Dev:        npm run electron:dev      (uses `next dev`)
// Ship:       npm run electron:build    (builds the standalone server, then
//                                        electron-builder produces an
//                                        installer for this platform)
'use strict'

const { app, BrowserWindow, shell } = require('electron')
const { spawn } = require('child_process')
const http = require('http')
const net = require('net')
const fs = require('fs')
const path = require('path')

const APP_ROOT = path.join(__dirname, '..')

let mainWindow = null
let serverProcess = null

/** The production standalone server exists after `npm run build`. */
function hasStandaloneServer() {
  return fs.existsSync(path.join(APP_ROOT, '.next', 'standalone', 'server.js'))
}

/** Minimal .env.local parser — enough for the NEXT_PUBLIC_* Supabase keys the
 *  auth proxy needs at runtime (dev mode loads them via Next itself). */
function loadEnvFile() {
  const file = path.join(APP_ROOT, '.env.local')
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

/** The auth proxy (proxy.ts) reads the Supabase keys from process.env at
 *  runtime, so a packaged build ships .env.local next to the server and
 *  main.cjs loads it into the child's environment. Without either, the app
 *  cannot start meaningfully — surface that instead of a silent 500. */
function hasSupabaseEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

/** Pick a free loopback port so the app never collides with a dev server or
 *  another instance already on 3000. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

function waitForServer(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/login' }, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('server start timeout'))
        else setTimeout(check, 400)
      })
      req.setTimeout(2000, () => {
        req.destroy()
        if (Date.now() > deadline) reject(new Error('server start timeout'))
        else setTimeout(check, 400)
      })
    }
    check()
  })
}

async function startServer() {
  const port = await findFreePort()
  if (hasStandaloneServer()) {
    loadEnvFile()
    if (!hasSupabaseEnv()) {
      console.error(
        '[freebuff] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing ' +
          '(no .env.local next to the app). The app cannot authenticate without them.',
      )
      if (app.isReady()) {
        const { dialog } = require('electron')
        dialog.showErrorBox(
          'Freebuff Desktop — thiếu cấu hình',
          'Không tìm thấy NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
            'Đặt tệp .env.local cạnh ứng dụng rồi mở lại.',
        )
      }
      throw new Error('missing Supabase env')
    }
    const env = {
      ...process.env,
      // The Electron binary doubles as plain Node for the standalone server.
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
    }
    serverProcess = spawn(process.execPath, ['server.js'], {
      cwd: path.join(APP_ROOT, '.next', 'standalone'),
      env,
      stdio: 'inherit',
    })
  } else {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const env = { ...process.env, PORT: String(port) }
    serverProcess = spawn(npmCmd, ['run', 'dev', '--', '-p', String(port)], {
      cwd: APP_ROOT,
      env,
      stdio: 'inherit',
    })
  }
  await waitForServer(port, 120000)
  return port
}

function stopServer() {
  if (!serverProcess) return
  const child = serverProcess
  serverProcess = null
  if (process.platform === 'win32') {
    // Windows: kill the whole process tree (npm/next spawn children).
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'Freebuff Desktop',
    backgroundColor: '#09090b',
    icon: path.join(APP_ROOT, 'assets', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.loadURL(url)
  // External links open in the system browser; the app itself never leaves
  // the window.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target)
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Single instance: a second launch focuses the existing window instead of
// starting another server.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      const port = await startServer()
      createWindow(`http://127.0.0.1:${port}`)
    } catch (err) {
      console.error('[freebuff] Failed to start:', err)
      app.quit()
    }
  })

  app.on('activate', () => {
    // macOS: re-create the window when the dock icon is clicked.
    if (mainWindow === null && app.isReady()) {
      // The server is gone (we quit on window-all-closed) — restart it.
      startServer()
        .then((port) => createWindow(`http://127.0.0.1:${port}`))
        .catch(() => app.quit())
    }
  })

  app.on('window-all-closed', () => {
    stopServer()
    app.quit()
  })

  app.on('will-quit', stopServer)
}
