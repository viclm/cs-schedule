#!/usr/bin/env node
/** 排班系统本地服务：静态页面 + Excel 微型数据库 API */
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../server/db');
const { handleAPI } = require('../server/api-routes');

const ROOT = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3456;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJSON(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
}

function serveStatic(req, res, url) {
  let fp = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fp.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    return send(res, 404, 'Not found');
  }

  const ext = path.extname(fp);
  const type = MIME[ext] || 'application/octet-stream';
  send(res, 200, fs.readFileSync(fp), { 'Content-Type': type });
}

const server = http.createServer(async (req, res) => {
  try {
    if ((req.url || '/').startsWith('/api/')) {
      await handleAPI(req, res);
    } else {
      const url = new URL(req.url || '/', `http://localhost:${PORT}`);
      serveStatic(req, res, url);
    }
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`排班系统: http://localhost:${PORT}`);
    console.log(`数据目录: ${db.DATA_DIR}`);
    const months = db.listMonths();
    console.log(`已有排班: ${months.map(m => `${m.year}-${m.month}`).join(', ') || '无'}`);
  });
}
