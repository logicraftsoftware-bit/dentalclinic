import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

test('the unbundled API boots in native Node without the development module loader', async () => {
  const root = resolve('.tools');
  await mkdir(root, { recursive: true });
  const output = await mkdtemp(join(root, 'native-api-'));
  const files: string[] = [], directories = new Set([output]);
  async function compile(folder: string) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const source = join(folder, item.name);
      if (item.isDirectory()) { await compile(source); continue; }
      if (!item.name.endsWith('.ts')) continue;
      const target = join(output, source.replace(/\.ts$/, '.js'));
      directories.add(dirname(target));
      await mkdir(dirname(target), { recursive: true });
      const result = await transform(await readFile(source, 'utf8'), { loader: 'ts', format: 'esm', target: 'node22' });
      await writeFile(target, result.code); files.push(target);
    }
  }
  try {
    for (const folder of ['api', 'server', 'shared']) await compile(folder);
    const entry = pathToFileURL(join(output, 'api/index.js')).href;
    const script = `const {default: app}=await import(${JSON.stringify(entry)}); if(typeof app !== 'function' || typeof app.listen !== 'function') throw new Error('Expected an Express API handler'); console.log('Native API ready');`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'test', VERCEL: '1', DATABASE_URL: 'mongodb://127.0.0.1:27019/runtime_check?replicaSet=rs0' }, timeout: 30000,
    });
    assert.match(stdout, /Native API ready/);
  } finally {
    for (const file of files) await unlink(file);
    for (const directory of [...directories].sort((a, b) => b.length - a.length)) await rmdir(directory);
  }
});
