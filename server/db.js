/** Excel 排班数据库：读写 + 上月状态分析 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const ScheduleConfig = require('../public/js/config');

const { SHIFT, MEMBERS, WEEKDAYS, toExcelDate } = ScheduleConfig;
const BUNDLED_DATA = path.join(__dirname, '..', 'data');
const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', 'shift-scheduler-data')
  : BUNDLED_DATA;
const MEMBER_NAMES = new Set(MEMBERS.map(m => m.name));

function ensureDataDir() {
  if (fs.existsSync(DATA_DIR)) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (process.env.VERCEL && fs.existsSync(BUNDLED_DATA)) {
    for (const f of fs.readdirSync(BUNDLED_DATA)) {
      if (/^\d{4}-\d{2}\.xlsx$/.test(f)) {
        fs.copyFileSync(path.join(BUNDLED_DATA, f), path.join(DATA_DIR, f));
      }
    }
  }
}

function filePath(year, month) {
  return path.join(DATA_DIR, `${year}-${String(month).padStart(2, '0')}.xlsx`);
}

function excelSerialToDate(serial) {
  return new Date(Math.round((serial - 25569) * 86400000));
}

function isWorkShift(v) {
  return v === SHIFT.Y1 || v === SHIFT.Y2;
}

/** 解析 Excel 排班文件 */
function parseExcel(bufferOrPath) {
  const wb = typeof bufferOrPath === 'string'
    ? XLSX.readFile(bufferOrPath)
    : XLSX.readFile(bufferOrPath, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });

  const dateRow = data[0] || [];
  let year, month, days = 0;
  for (let c = 1; c < dateRow.length; c++) {
    if (!dateRow[c] || typeof dateRow[c] !== 'number') break;
    const dt = excelSerialToDate(dateRow[c]);
    if (!year) {
      year = dt.getUTCFullYear();
      month = dt.getUTCMonth() + 1;
    }
    days++;
  }

  const schedule = {};
  for (let r = 2; r < data.length; r++) {
    const name = data[r][0];
    if (!name || !MEMBER_NAMES.has(name)) continue;
    schedule[name] = [];
    for (let d = 0; d < days; d++) {
      const v = data[r][d + 1];
      schedule[name].push(normalizeShift(v));
    }
  }

  // 补齐缺失成员
  for (const m of MEMBERS) {
    if (!schedule[m.name]) schedule[m.name] = new Array(days).fill(SHIFT.OFF);
  }

  const dayOfWeeks = [];
  for (let d = 1; d <= days; d++) {
    dayOfWeeks.push(new Date(year, month - 1, d).getDay());
  }

  return {
    year, month, days, dayOfWeeks,
    schedule,
    memberStates: analyzeAllMembers(schedule, days),
  };
}

function normalizeShift(v) {
  if (v === SHIFT.Y1 || v === SHIFT.Y2 || v === SHIFT.OFF) return v;
  return SHIFT.OFF; // 中班/白班等视为休
}

/** 分析成员在上月末的班次状态 */
function analyzeMember(row, days) {
  let lastWorkShift = null;
  let lastDayStatus = row[days - 1] || SHIFT.OFF;

  for (let i = days - 1; i >= 0; i--) {
    if (isWorkShift(row[i])) {
      lastWorkShift = row[i];
      break;
    }
  }

  // 当前阶段起始：从末尾往回找班次切换点
  let phaseShift = lastWorkShift;
  let phaseDays = 0;
  if (phaseShift) {
    for (let i = days - 1; i >= 0; i--) {
      if (row[i] === SHIFT.OFF) continue;
      if (row[i] !== phaseShift) break;
      phaseDays++;
    }
  }

  // 更精确：从月初扫描阶段（含切换休息）
  const phases = detectPhases(row, days);
  const currentPhase = phases[phases.length - 1] || { shift: phaseShift, days: phaseDays };

  const y1 = row.filter(v => v === SHIFT.Y1).length;
  const y2 = row.filter(v => v === SHIFT.Y2).length;
  const off = row.filter(v => v === SHIFT.OFF).length;

  const tail = row.slice(Math.max(0, days - 7));
  let tailWorkStreak = 0;
  for (let i = days - 1; i >= 0; i--) {
    if (row[i] === SHIFT.OFF) break;
    tailWorkStreak++;
  }
  let tailRestStreak = 0;
  for (let i = days - 1; i >= 0; i--) {
    if (row[i] !== SHIFT.OFF) break;
    tailRestStreak++;
  }

  return {
    prevShift: currentPhase.shift || lastWorkShift,
    phaseDays: currentPhase.days,
    lastDayStatus,
    lastWorkShift,
    tailWorkStreak,
    tailRestStreak,
    tail7: tail,
    y1, y2, off,
    phases,
  };
}

function detectPhases(row, days) {
  const phases = [];
  let i = 0;
  while (i < days) {
    while (i < days && !isWorkShift(row[i])) i++;
    if (i >= days) break;
    const shift = row[i];
    let count = 0;
    while (i < days) {
      if (row[i] === SHIFT.OFF) { i++; continue; }
      if (row[i] !== shift) break;
      count++;
      i++;
    }
    if (count > 0) phases.push({ shift, days: count, endDay: i });
  }
  return phases;
}

function analyzeAllMembers(schedule, days) {
  const states = {};
  for (const m of MEMBERS) {
    states[m.name] = analyzeMember(schedule[m.name], days);
  }
  return states;
}

/** 根据上月状态计算本月班次阶段（与 js/config.js 一致） */
function computeShiftPhases(member, memberState, totalDays) {
  return ScheduleConfig.computeShiftPhasesFromState(member, memberState, totalDays);
}

function opposite(s) {
  return s === SHIFT.Y1 ? SHIFT.Y2 : SHIFT.Y1;
}

function getShiftPhasesFromConfig(member, totalDays) {
  return ScheduleConfig.getShiftPhases(member, totalDays);
}

/** 写入 Excel */
function writeExcel(year, month, schedule, days, dayOfWeeks) {
  ensureDataDir();
  const rows = [];

  const dateRow = [''];
  for (let d = 1; d <= days; d++) dateRow.push(toExcelDate(year, month, d));
  dateRow.push('', '');
  rows.push(dateRow);

  const dowRow = [''];
  for (let d = 0; d < days; d++) dowRow.push(WEEKDAYS[dayOfWeeks[d]]);
  dowRow.push('剩余休息天数', '备注');
  rows.push(dowRow);

  for (const m of MEMBERS) {
    const row = [m.name];
    let remainingRest = ScheduleConfig.getRestDays(m, year, month);
    const memberRow = schedule[m.name] || [];
    for (let d = 0; d < days; d++) {
      const v = memberRow[d] || SHIFT.OFF;
      row.push(v);
      if (v === SHIFT.OFF) remainingRest--;
    }
    row.push(Math.max(0, remainingRest), '');
    rows.push(row);
  }

  rows.push(['中班：17：30-1：00']);
  rows.push(['夜一：20：00-3：30']);
  rows.push(['夜二：1：30-9：00']);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  for (let c = 1; c <= days; c++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[ref]) ws[ref].t = 'n';
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const fp = filePath(year, month);
  XLSX.writeFile(wb, fp);
  return fp;
}

function listMonths() {
  ensureDataDir();
  return fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}\.xlsx$/.test(f))
    .map(f => {
      const [y, m] = f.replace('.xlsx', '').split('-').map(Number);
      return { year: y, month: m, file: f };
    })
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
}

function loadMonth(year, month) {
  const fp = filePath(year, month);
  if (!fs.existsSync(fp)) return null;
  return parseExcel(fp);
}

function prevMonth(year, month) {
  const d = new Date(year, month - 2, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function readFileBuffer(year, month) {
  const fp = filePath(year, month);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp);
}

module.exports = {
  DATA_DIR, parseExcel, writeExcel, listMonths, loadMonth, prevMonth,
  readFileBuffer, analyzeMember, computeShiftPhases, filePath,
};
