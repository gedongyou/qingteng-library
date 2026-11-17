/* 极简静态文件服务器（零依赖，Node >= 18）
   纯静态版不需要数据库和后端接口，只要把 HTML/CSS/JS 发给浏览器即可。
   用法：node serve.mjs [端口]     默认 8090 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8090);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

async function resolve(pathname) {
  const clean = decodeURIComponent(pathname.split('?')[0]);
  let file = path.join(ROOT, path.normalize(clean).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) return null;
  try {
    const st = await stat(file);
    if (st.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    // 目录形式的老链接（/search、/book/12）→ 兜到对应的 .html
    const guess = path.join(ROOT, clean.replace(/^\//, '').replace(/\/$/, '') + '.html');
    try {
      const st2 = await stat(guess);
      if (st2.isFile()) return guess;
    } catch { /* 继续走 404 */ }
    return path.join(ROOT, '404.html');
  }
  return file;
}

const server = http.createServer(async (req, res) => {
  const file = await resolve(req.url || '/');
  if (!file) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('禁止访问');
    return;
  }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not file');
    const ext = path.extname(file).toLowerCase();
    const is404 = file.endsWith('404.html') && !(req.url || '').includes('404.html');
    res.writeHead(is404 ? 404 : 200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('读取文件失败');
  }
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return [...new Set(out)];
}

server.listen(PORT, '0.0.0.0', () => {
  const line = (label, url) => console.log(`  ${label.padEnd(6)} ${url}`);
  console.log('\n  青藤图书室 · 纯静态版（无后端、无数据库，数据存在浏览器里）\n');
  line('本机', `http://127.0.0.1:${PORT}/`);
  for (const ip of lanAddresses()) line('内网', `http://${ip}:${PORT}/`);
  console.log('\n  页面：/index.html  /search.html  /book.html?id=1  /my.html  /admin.html');
  console.log('  账号：读者 2023010101 / 123456　馆员 lib001 / lib123　管理员 admin / admin123\n');
});
