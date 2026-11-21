import { cp, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/lambda.ts'],
  outfile: 'dist/lambda.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
});
await cp('web', 'dist/web', { recursive: true });
await writeFile('dist/package.json', '{"type":"commonjs"}\n');
