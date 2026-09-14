import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..');
const web = resolve(process.cwd(), 'www');

await rm(web, { recursive: true, force: true });
await mkdir(web, { recursive: true });

for (const file of ['index.html', 'app.js', 'styles.css', 'manifest.json']) {
  await cp(resolve(root, file), resolve(web, file));
}

console.log('Prepared Open Talk web assets for Capacitor:', web);
