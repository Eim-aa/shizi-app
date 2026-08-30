const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, statSync } = require('node:fs');
const http = require('node:http');
const { extname, resolve, sep } = require('node:path');
const { chromium } = require('playwright');

const ROOT = resolve(__dirname, '..');
const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'));
const RUNTIME = MANIFEST.quality.runtime_dependency;
const RUNTIME_PATH = resolve(ROOT, RUNTIME.path);
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function loadFrozenRuntime() {
  assert.ok(RUNTIME_PATH.startsWith(`${ROOT}${sep}`), 'runtime path escapes bundle root');
  assert.ok(existsSync(RUNTIME_PATH), `frozen runtime is missing: ${RUNTIME.path}`);
  const raw = readFileSync(RUNTIME_PATH);
  assert.equal(raw.byteLength, RUNTIME.byte_size, 'frozen runtime byte-size mismatch');
  assert.equal(sha256(raw), RUNTIME.sha256, 'frozen runtime SHA-256 mismatch');
  return raw;
}

function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relativePath = decodeURIComponent(url.pathname === '/' ? '/review.html' : url.pathname).replace(/^\/+/, '');
    const filePath = resolve(ROOT, relativePath);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream' });
    response.end(readFileSync(filePath));
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise(server));
  });
}

(async () => {
  const { validateBundle } = await import('./verify.mjs');
  validateBundle(ROOT);
  const runtimeBytes = loadFrozenRuntime();
  const server = await startServer();
  const address = server.address();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage();
  const errors = [];
  const localOrigin = `http://127.0.0.1:${address.port}`;
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.route('**/*', (route) => {
    const requestUrl = route.request().url();
    if (requestUrl === RUNTIME.source_url) {
      route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: runtimeBytes,
      });
      return;
    }
    if (requestUrl.startsWith(`${localOrigin}/`)) {
      route.continue();
      return;
    }
    errors.push(`unexpected network request: ${requestUrl}`);
    route.abort();
  });

  try {
    await page.goto(`${localOrigin}/review.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__MVE_RESULT__?.done === true, null, { timeout: 30_000 });
    const result = await page.evaluate(() => window.__MVE_RESULT__);
    assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`);
    assert.equal(result.fatal, undefined, `review harness failed: ${result.fatal}`);

    const expected = MANIFEST.records.map((record) => ({
      character: record.character,
      strokes: record.stroke_count,
      status: 'pass',
    }));
    assert.deepEqual(result.results, expected, 'browser result does not match manifest records');
    const strokes = result.results.reduce((sum, record) => sum + record.strokes, 0);
    assert.equal(strokes, MANIFEST.scope.stroke_count, 'browser stroke count mismatch');
    console.log(`PASS browser ${result.results.length} characters, ${strokes} strokes`);
  } finally {
    await browser.close();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
})().catch((error) => {
  console.error(`FAIL browser ${error.message}`);
  process.exitCode = 1;
});
