import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parts = [0,1,2,3].map(i => fs.readFileSync(path.join(__dirname, `app.b64.${i}.txt`), 'utf8').trim());
const buf = Buffer.from(parts.join(''), 'base64');
const out = path.join(__dirname, '..', 'public', 'app.js');
fs.writeFileSync(out, buf);
if (buf.length < 20000) {
  console.error('restore failed, size', buf.length);
  process.exit(1);
}
console.log('restored public/app.js', buf.length, 'bytes');
