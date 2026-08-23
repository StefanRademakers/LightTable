const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('enable-unsafe-webgpu');

const root = __dirname;
const types = new Map([
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.wasm', 'application/wasm'],
]);

const server = http.createServer((request, response) => {
  const relative = new URL(request.url, 'http://127.0.0.1').pathname.replace(/^\/+/, '');
  const target = path.resolve(root, relative || 'index.html');
  if (!target.startsWith(`${root}${path.sep}`) && target !== path.join(root, 'index.html')) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': types.get(path.extname(target)) ?? 'application/octet-stream' });
    response.end(data);
  });
});

let completed = false;
const finish = (code, message) => {
  if (completed) return;
  completed = true;
  fs.writeFileSync(
    path.join(root, 'probe-result.json'),
    `${JSON.stringify({ code, message, completedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  server.close(() => app.exit(code));
};

app.whenReady().then(() => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
    window.webContents.on('console-message', (details) => {
      console.log(details.message);
      if (details.message.startsWith('INTEROP_PASS')) finish(0, details.message);
      if (details.message.startsWith('INTEROP_FAIL')) finish(1, details.message);
    });
    window.loadURL(`http://127.0.0.1:${port}/index.html`);
  });
});

setTimeout(() => {
  console.error('INTEROP_FAIL timeout');
  finish(2, 'INTEROP_FAIL timeout');
}, 30_000);
