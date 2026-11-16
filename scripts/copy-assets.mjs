import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const assets = [
  'app.js',
  'index.html',
  'styles.css',
  'clarity.css',
  'minimal.css',
  'nav-fix.css',
  'i18n.js',
  'seek-bar.js',
  'api-states.css',
  'player-queue.js',
  'player-errors.js',
  'player-volume.js',
];

const publicDir = resolve(process.cwd(), 'public');
await mkdir(publicDir, { recursive: true });
for (const asset of assets) await copyFile(resolve(process.cwd(), asset), resolve(publicDir, asset));

const appSize = (await stat(resolve(publicDir, 'app.js'))).size;
if (appSize < 1000) {
  console.error(`FATAL public/app.js is too small (${appSize} bytes)`);
  process.exit(1);
}
const html = await readFile(resolve(publicDir, 'index.html'), 'utf8');
for (const marker of ['id="youtube-player"', 'src="app.js', 'mobile-nav']) {
  if (!html.includes(marker)) {
    console.error(`FATAL public/index.html is missing ${marker}`);
    process.exit(1);
  }
}
console.log(`Copied ${assets.length} frontend assets; public/app.js is ${appSize} bytes.`);
