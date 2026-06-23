#!/usr/bin/env node
/** 排班系统本地服务：静态页面 + Excel 微型数据库 API */
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./server/db');

const ROOT = path.join(__dirname);
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleAPI(req, res, url) {
  // GET /api/months
  if (req.method === 'GET' && url.pathname === '/api/months') {
    return sendJSON(res, 200, { months: db.listMonths() });
  }

  // GET /api/months/:year/:month
  const getMatch = url.pathname.match(/^\/api\/months\/(\d{4})\/(\d{1,2})$/);
  if (req.method === 'GET' && getMatch) {
    const year = +getMatch[1], month = +getMatch[2];
    const data = db.loadMonth(year, month);
    if (!data) return sendJSON(res, 404, { error: '未找到该月排班' });
    return sendJSON(res, 200, data);
  }

  // GET /api/months/:year/:month/download
  const dlMatch = url.pathname.match(/^\/api\/months\/(\d{4})\/(\d{1,2})\/download$/);
  if (req.method === 'GET' && dlMatch) {
    const year = +dlMatch[1], month = +dlMatch[2];
    const buf = db.readFileBuffer(year, month);
    if (!buf) return sendJSON(res, 404, { error: '未找到该月排班' });
    const filename = encodeURIComponent(`${year}年${month}月客服排班.xlsx`);
    return send(res, 200, buf, {
      'Content-Type': MIME['.xlsx'],
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    });
  }

  // POST /api/months/:year/:month  保存排班
  const postMatch = url.pathname.match(/^\/api\/months\/(\d{4})\/(\d{1,2})$/);
  if (req.method === 'POST' && postMatch) {
    const year = +postMatch[1], month = +postMatch[2];
    const body = await readBody(req);
    const payload = JSON.parse(body.toString());
    const { schedule, days, dayOfWeeks } = payload;
    db.writeExcel(year, month, schedule, days, dayOfWeeks);
    return sendJSON(res, 200, { ok: true, file: `${year}-${String(month).padStart(2, '0')}.xlsx` });
  }

  // GET /api/prev/:year/:month  获取上月数据（生成依据）
  const prevMatch = url.pathname.match(/^\/api\/prev\/(\d{4})\/(\d{1,2})$/);
  if (req.method === 'GET' && prevMatch) {
    const year = +prevMatch[1], month = +prevMatch[2];
    const pm = db.prevMonth(year, month);
    const data = db.loadMonth(pm.year, pm.month);
    if (!data) return sendJSON(res, 404, { error: `缺少${pm.year}年${pm.month}月排班数据`, prevMonth: pm });
    return sendJSON(res, 200, { prevMonth: pm, ...data });
  }

  sendJSON(res, 404, { error: 'Not found' });
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
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleAPI(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: e.message });
  }
});

if (require.main === module && !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`排班系统: http://localhost:${PORT}`);
    console.log(`数据目录: ${db.DATA_DIR}`);
    const months = db.listMonths();
    console.log(`已有排班: ${months.map(m => `${m.year}-${m.month}`).join(', ') || '无'}`);
  });
}

const serverless = require('serverless-http');
module.exports = serverless(server);
