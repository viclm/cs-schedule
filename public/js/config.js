/** 排班系统配置 */
const SHIFT = { Y1: '夜一', Y2: '夜二', OFF: '休' };

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** 夜一 / 夜二轮换周期（天） */
const SHIFT_CYCLE_DAYS = 30;

/** 换班前后强制休息天数 */
const SWITCH_REST_DAYS = 2;

/** 默认每月休息天数 */
const DEFAULT_REST_DAYS = 6;

/** 按月份覆盖休息天数，如 '2026-7': 6 */
const REST_DAYS_BY_MONTH = {
  '2026-7': 6,
};

/** 固定只上夜二 */
const FIXED_Y2 = new Set(['Edison', 'Ethan', 'Harley', 'Zeyad']);

/** 休息日偏好：Ethan 倾向周日/周一；Andrew/Chao/Harvey/Zeyad 倾向周末 */
const REST_PREF_SUN_MON = new Set(['Ethan']);
const REST_PREF_WEEKEND = new Set(['Andrew', 'Chao', 'Harvey', 'Zeyad']);

/** 每日最低人数要求 */
function getDailyMin(dayOfWeek) {
  if (dayOfWeek === 6) return { y1: 4, y2: 7 };
  if (dayOfWeek === 0) return { y1: 4, y2: 5 };
  if (dayOfWeek === 1) return { y1: 5, y2: 5 };
  return { y1: 5, y2: 7 };
}

function getRestDays(member, year, month) {
  if (year == null || month == null) return member.restDays ?? DEFAULT_REST_DAYS;
  const key = `${year}-${month}`;
  if (REST_DAYS_BY_MONTH[key] !== undefined) return REST_DAYS_BY_MONTH[key];
  return member.restDays ?? DEFAULT_REST_DAYS;
}

/** 休息日偏好分：越小越优先该日休息 */
function restDayPreferenceScore(memberName, dayOfWeek) {
  if (REST_PREF_SUN_MON.has(memberName)) {
    return (dayOfWeek === 0 || dayOfWeek === 1) ? 0 : 5;
  }
  if (REST_PREF_WEEKEND.has(memberName)) {
    return (dayOfWeek === 0 || dayOfWeek === 6) ? 0 : 5;
  }
  return 3;
}

const MEMBERS = [
  { name: 'Edison', restDays: 6, fixedShift: SHIFT.Y2, prevShift: SHIFT.Y2, prevDuration: 'month', june1: SHIFT.Y2 },
  { name: 'Liam', restDays: 6, prevShift: SHIFT.Y2, prevDuration: 'month', june1: SHIFT.OFF },
  { name: 'Kwofie', restDays: 6, prevShift: SHIFT.Y2, prevDuration: 'half', june1: SHIFT.OFF },
  { name: 'Duke', restDays: 6, prevShift: SHIFT.Y1, prevDuration: 'month', june1: SHIFT.Y1 },
  { name: 'Ethan', restDays: 6, fixedShift: SHIFT.Y2, prevShift: SHIFT.Y2, prevDuration: 'month', june1: SHIFT.Y2 },
  { name: 'Kuhn', restDays: 6, prevShift: SHIFT.Y1, prevDuration: 'half', june1: SHIFT.OFF },
  { name: 'Harvey', restDays: 6, prevShift: SHIFT.Y2, prevDuration: 'month', june1: SHIFT.OFF },
  { name: 'Andrew', restDays: 6, prevShift: SHIFT.Y1, prevDuration: '4weeks', june1: SHIFT.Y1 },
  { name: 'Bob', restDays: 6, prevShift: SHIFT.Y1, prevDuration: 'month', june1: SHIFT.Y1 },
  { name: 'Harley', restDays: 6, fixedShift: SHIFT.Y2, prevShift: SHIFT.Y2, prevDuration: 'month', june1: SHIFT.OFF },
  { name: 'Zeyad', restDays: 6, fixedShift: SHIFT.Y2, prevShift: SHIFT.Y2, prevDuration: 'month', june1: SHIFT.Y2 },
  { name: 'Chao', restDays: 6, prevShift: SHIFT.Y2, prevDuration: '2weeks', june1: SHIFT.OFF },
  { name: 'Kelsey', restDays: 6, prevShift: SHIFT.Y1, prevDuration: 'half', june1: SHIFT.Y1 },
  { name: 'Glorious', restDays: 6, prevShift: SHIFT.Y2, prevDuration: '3weeks', june1: SHIFT.Y2 },
  { name: 'Sven', restDays: 6, prevShift: SHIFT.Y2, prevDuration: '3weeks', june1: SHIFT.Y2 },
  { name: 'Zac', restDays: 6, prevShift: SHIFT.Y1, prevDuration: 'month', june1: SHIFT.Y1 },
];

function oppositeShift(s) {
  return s === SHIFT.Y1 ? SHIFT.Y2 : SHIFT.Y1;
}

/** 无上月 Excel 时：整月沿用 prevShift */
function getShiftPhases(member, totalDays) {
  if (member.fixedShift) {
    return [{ shift: member.fixedShift, start: 0, end: totalDays }];
  }
  const prev = member.prevShift;
  if (prev === SHIFT.Y1 || prev === SHIFT.Y2) {
    return [{ shift: prev, start: 0, end: totalDays }];
  }
  return [{ shift: SHIFT.Y2, start: 0, end: totalDays }];
}

function getShiftForDay(phases, dayIndex) {
  for (const p of phases) {
    if (dayIndex >= p.start && dayIndex < p.end) return p.shift;
  }
  return phases[phases.length - 1].shift;
}

/**
 * 根据上月末累计班次天数，计算本月阶段。
 * 例：上月已上 15 天夜一 → 本月再上 15 天夜一 → 休 2 天 → 转夜二。
 */
function computeShiftPhasesFromState(member, state, totalDays) {
  if (member.fixedShift) {
    return [{ shift: member.fixedShift, start: 0, end: totalDays }];
  }

  const current = state?.prevShift;
  if (current !== SHIFT.Y1 && current !== SHIFT.Y2) {
    return getShiftPhases(member, totalDays);
  }

  const phaseDays = state?.phaseDays || 0;
  const remaining = SHIFT_CYCLE_DAYS - phaseDays;
  const next = oppositeShift(current);

  if (remaining >= totalDays) {
    return [{ shift: current, start: 0, end: totalDays }];
  }

  if (remaining <= 0) {
    if (SWITCH_REST_DAYS >= totalDays) {
      return [{ shift: current, start: 0, end: totalDays }];
    }
    return [{ shift: next, start: SWITCH_REST_DAYS, end: totalDays }];
  }

  const newStart = remaining + SWITCH_REST_DAYS;
  if (newStart >= totalDays) {
    return [{ shift: current, start: 0, end: totalDays }];
  }

  return [
    { shift: current, start: 0, end: remaining },
    { shift: next, start: newStart, end: totalDays },
  ];
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function getMonthMeta(year, month) {
  const days = getDaysInMonth(year, month);
  const dates = [];
  const dayOfWeeks = [];
  for (let d = 1; d <= days; d++) {
    const dt = new Date(year, month - 1, d);
    dates.push(dt);
    dayOfWeeks.push(dt.getDay());
  }
  return { year, month, days, dates, dayOfWeeks };
}

function toExcelDate(year, month, day) {
  const utc = Date.UTC(year, month - 1, day);
  return Math.floor(utc / 86400000) + 25569;
}

const ScheduleConfig = {
  SHIFT, WEEKDAYS, MEMBERS, SHIFT_CYCLE_DAYS, SWITCH_REST_DAYS, DEFAULT_REST_DAYS,
  FIXED_Y2, getDailyMin, getRestDays, restDayPreferenceScore,
  getShiftPhases, getShiftForDay, computeShiftPhasesFromState,
  getDaysInMonth, getMonthMeta, toExcelDate, oppositeShift,
};

if (typeof window !== 'undefined') window.ScheduleConfig = ScheduleConfig;
if (typeof module !== 'undefined') module.exports = ScheduleConfig;
