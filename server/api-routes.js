/** API 路由（本地 server 与 Vercel 共用） */
const db = require('./db');

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

function requestUrl(req) {
  const host = req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return new URL(req.url || '/', `${proto}://${host}`);
}

async function handleAPI(req, res) {
  const url = requestUrl(req);

  if (req.method === 'GET' && url.pathname === '/api/months') {
    return sendJSON(res, 200, { months: db.listMonths() });
  }

  const getMatch = url.pathname.match(/^\/api\/months\/(\d{4})\/(\d{1,2})$/);
  if (req.method === 'GET' && getMatch) {
    const year = +getMatch[1], month = +getMatch[2];
    const data = db.loadMonth(year, month);
    if (!data) return sendJSON(res, 404, { error: '未找到该月排班' });
    return sendJSON(res, 200, data);
  }

  const dlMatch = url.pathname.match(/^\/api\/months\/(\d{4})\/(\d{1,2})\/download$/);
  if (req.method === 'GET' && dlMatch) {
    const year = +dlMatch[1], month = +dlMatch[2];
    const buf = db.readFileBuffer(year, month);
    if (!buf) return sendJSON(res, 404, { error: '未找到该月排班' });
    const filename = encodeURIComponent(`${year}年${month}月客服排班.xlsx`);
    return send(res, 200, buf, {
      'Content-Type': MIME_XLSX,
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    });
  }

  const postMatch = url.pathname.match(/^\/api\/months\/(\d{4})\/(\d{1,2})$/);
  if (req.method === 'POST' && postMatch) {
    const year = +postMatch[1], month = +postMatch[2];
    const body = await readBody(req);
    const payload = JSON.parse(body.toString());
    const { schedule, days, dayOfWeeks } = payload;
    db.writeExcel(year, month, schedule, days, dayOfWeeks);
    return sendJSON(res, 200, { ok: true, file: `${year}-${String(month).padStart(2, '0')}.xlsx` });
  }

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

module.exports = { handleAPI };
