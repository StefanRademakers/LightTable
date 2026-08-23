const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('enable-unsafe-webgpu');

const root = path.join(__dirname, 'bakeoff-dist');
const requestedOutput = process.env.LIGHTTABLE_BAKEOFF_REPORT || 'bakeoff-report.json';
if (path.basename(requestedOutput) !== requestedOutput || !/^bakeoff-report(?:-\d+)?\.json$/.test(requestedOutput)) {
  throw new Error(`Invalid bake-off report name: ${requestedOutput}`);
}
const output = path.join(__dirname, requestedOutput);
const types = new Map([
  ['.html', 'text/html'], ['.js', 'text/javascript'], ['.wasm', 'application/wasm']
]);
const server = http.createServer((request, response) => {
  const relative = new URL(request.url, 'http://127.0.0.1').pathname.replace(/^\/+/, '');
  const target = path.resolve(root, relative || 'bakeoff.html');
  if (!target.startsWith(`${root}${path.sep}`) && target !== path.join(root, 'bakeoff.html')) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) return response.writeHead(404).end();
    response.writeHead(200, {
      'content-type': types.get(path.extname(target)) ?? 'application/octet-stream',
      'cache-control': 'no-store'
    });
    response.end(data);
  });
});

let complete = false;
const phaseMetrics = {};
const processMetrics = () => app.getAppMetrics().map(metric => ({
  type: metric.type,
  cpuPercent: metric.cpu.percentCPUUsage,
  workingSetKb: metric.memory.workingSetSize,
  peakWorkingSetKb: metric.memory.peakWorkingSetSize
}));
const finish = (code, report) => {
  if (complete) return;
  complete = true;
  fs.writeFileSync(output, `${JSON.stringify({
    code,
    ...report,
    phaseMetrics,
    gpuFeatureStatus: app.getGPUFeatureStatus()
  }, null, 2)}\n`);
  server.close(() => app.exit(code));
};

app.whenReady().then(() => server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  window.webContents.on('console-message', ({ message }) => {
    console.log(message);
    if (message.startsWith('BAKEOFF_PHASE ')) {
      phaseMetrics[message.slice('BAKEOFF_PHASE '.length)] = processMetrics();
      return;
    }
    if (!message.startsWith('BAKEOFF_')) return;
    const separator = message.indexOf(' ');
    const marker = separator < 0 ? message : message.slice(0, separator);
    const payload = separator < 0 ? {} : JSON.parse(message.slice(separator + 1));
    finish(marker === 'BAKEOFF_PASS' ? 0 : 1, payload);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    finish(2, { error: `renderer process gone: ${details.reason}` });
  });
  window.loadURL(`http://127.0.0.1:${port}/bakeoff.html`);
}));

setTimeout(() => finish(3, { error: 'bake-off timeout' }), 60_000);
