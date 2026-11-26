import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const coreDir = path.join(projectRoot, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const targetDir = path.join(projectRoot, 'public', 'ffmpeg');
const assets = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

if (!fs.existsSync(coreDir)) {
  console.warn(`[copy-ffmpeg-core] Direktori sumber tidak ditemukan: ${coreDir}`);
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });

for (const fileName of assets) {
  const src = path.join(coreDir, fileName);
  const dst = path.join(targetDir, fileName);
  if (!fs.existsSync(src)) {
    throw new Error(`[copy-ffmpeg-core] Aset tidak ditemukan: ${src}`);
  }
  fs.copyFileSync(src, dst);
  const stat = fs.statSync(dst);
  console.log(`[copy-ffmpeg-core] ${fileName} (${stat.size} bytes) -> public/ffmpeg/${fileName}`);
}
