import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { readdir, mkdir } from 'node:fs/promises';

// A private ephemeral-port server keeps validation independent of npm run dev.
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true }, logLevel: 'error' });
await mkdir('test-results', { recursive: true });
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('The test preview server did not start.');
  const baseURL = `http://127.0.0.1:${address.port}`;
  const available = (await readdir('tests/e2e/browser')).filter(file => file.endsWith('.mjs')).sort();
  const requested = process.argv.slice(2);
  for (const name of requested) if (!available.includes(name)) throw new Error(`Unknown browser check: ${name}`);
  const files = requested.length ? available.filter(name => requested.includes(name)) : available;
  for (const file of files) {
    console.log(`Browser check: ${file}`);
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`tests/e2e/browser/${file}`], { stdio: 'inherit', env: { ...process.env, HELPOS_TEST_URL: baseURL } });
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
    if (code !== 0) { process.exitCode = code; break; }
  }
} finally { await server.close(); }
