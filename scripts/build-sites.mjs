import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
execFileSync('npx', ['vite', 'build', '--outDir', 'dist/client', '--emptyOutDir'], {
  stdio: 'inherit',
});

mkdirSync('dist/server', { recursive: true });
copyFileSync('server/sites-worker.mjs', 'dist/server/index.js');
mkdirSync('dist/_appgen_meta', { recursive: true });
copyFileSync('.openai/hosting.json', 'dist/_appgen_meta/appgarden.json');
