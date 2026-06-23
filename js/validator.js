/** 排班约束校验 */
const Validator = (() => {
  const { SHIFT, MEMBERS, getDailyMin, getRestDays } = window.ScheduleConfig;

  const WORK = new Set([SHIFT.Y1, SHIFT.Y2]);

  function isWork(v) {
    return WORK.has(v);
  }

  function isOff(v) {
    return v === SHIFT.OFF;
  }

  /** 只统计 16 名成员，与表格一致 */
  function countDay(schedule, dayIndex) {
    let y1 = 0, y2 = 0, off = 0;
    for (const m of MEMBERS) {
      const v = schedule[m.name]?.[dayIndex];
      if (v === SHIFT.Y1) y1++;
      else if (v === SHIFT.Y2) y2++;
      else if (isOff(v)) off++;
    }
    return { y1, y2, off, work: y1 + y2 };
  }

  function checkDailyMin(schedule, dayOfWeeks) {
    const issues = [];
    for (let d = 0; d < dayOfWeeks.length; d++) {
      const min = getDailyMin(dayOfWeeks[d]);
      const c = countDay(schedule, d);
      if (c.y1 < min.y1) {
        issues.push({ day: d + 1, type: 'dailyMin', shift: SHIFT.Y1, need: min.y1, have: c.y1 });
      }
      if (c.y2 < min.y2) {
        issues.push({ day: d + 1, type: 'dailyMin', shift: SHIFT.Y2, need: min.y2, have: c.y2 });
      }
    }
    return issues;
  }

  function checkRestQuota(schedule, members, year, month) {
    const issues = [];
    for (const m of members) {
      const row = schedule[m.name] || [];
      const off = row.filter(isOff).length;
      const need = getRestDays(m, year, month);
      if (off !== need) {
        issues.push({ member: m.name, type: 'restQuota', need, have: off });
      }
    }
    return issues;
  }

  function checkMinWorkBeforeRest(schedule, memberName, totalDays) {
    const row = schedule[memberName];
    const issues = [];
    for (let d = 0; d < totalDays; d++) {
      if (!isOff(row[d])) continue;
      let workBefore = 0;
      for (let i = d - 1; i >= 0; i--) {
        if (isOff(row[i])) break;
        if (isWork(row[i])) workBefore++;
      }
      if (workBefore > 0 && workBefore < 4) {
        issues.push({ member: memberName, day: d + 1, type: 'minWorkBeforeRest', workBefore });
      }
    }
    return issues;
  }

  /** 每人只报最早一个 7 天无休息 窗口，避免 86 条重复 */
  function checkWeeklyRest(schedule, memberName, totalDays) {
    const row = schedule[memberName];
    const issues = [];
    for (let start = 0; start <= totalDays - 7; start++) {
      let off = 0;
      for (let i = start; i < start + 7; i++) {
        if (isOff(row[i])) off++;
      }
      if (off === 0) {
        issues.push({ member: memberName, day: start + 1, type: 'weeklyRest', endDay: start + 7 });
        break;
      }
    }
    return issues;
  }

  /** 两段不同班次之间至少 2 天休息 */
  function checkShiftSwitchRest(schedule, memberName, totalDays) {
    const row = schedule[memberName];
    const issues = [];
    const blocks = [];

    let i = 0;
    while (i < totalDays) {
      if (!isWork(row[i])) { i++; continue; }
      const shift = row[i];
      const start = i;
      while (i < totalDays && row[i] === shift) i++;
      blocks.push({ shift, start, end: i - 1 });
    }

    for (let b = 1; b < blocks.length; b++) {
      const prev = blocks[b - 1];
      const curr = blocks[b];
      if (prev.shift === curr.shift) continue;
      const restBetween = curr.start - prev.end - 1;
      if (restBetween < 2) {
        issues.push({
          member: memberName,
          day: curr.start + 1,
          type: 'shiftSwitchRest',
          restBetween,
          from: prev.shift,
          to: curr.shift,
        });
      }
    }
    return issues;
  }

  function checkFixedShift(schedule, members) {
    const issues = [];
    for (const m of members) {
      if (!m.fixedShift) continue;
      (schedule[m.name] || []).forEach((v, d) => {
        if (isWork(v) && v !== m.fixedShift) {
          issues.push({ member: m.name, day: d + 1, type: 'fixedShift', expected: m.fixedShift, have: v });
        }
      });
    }
    return issues;
  }

  function validate(schedule, members, dayOfWeeks, year, month) {
    const totalDays = dayOfWeeks.length;
    const issues = [];
    issues.push(...checkDailyMin(schedule, dayOfWeeks));
    issues.push(...checkFixedShift(schedule, members));
    for (const m of members) {
      issues.push(...checkMinWorkBeforeRest(schedule, m.name, totalDays));
      issues.push(...checkWeeklyRest(schedule, m.name, totalDays));
      issues.push(...checkShiftSwitchRest(schedule, m.name, totalDays));
    }
    return { valid: issues.length === 0, issues };
  }

  function groupIssues(issues) {
    const groups = {};
    for (const issue of issues) {
      groups[issue.type] = (groups[issue.type] || 0) + 1;
    }
    return groups;
  }

  function summarize(schedule, dayOfWeeks) {
    const daily = dayOfWeeks.map((dow, i) => {
      const min = getDailyMin(dow);
      const c = countDay(schedule, i);
      return {
        day: i + 1,
        dow: window.ScheduleConfig.WEEKDAYS[dow],
        ...c,
        min,
        ok: c.y1 >= min.y1 && c.y2 >= min.y2,
      };
    });
    return { daily };
  }

  return { validate, summarize, countDay, groupIssues };
})();

if (typeof window !== 'undefined') window.Validator = Validator;
if (typeof module !== 'undefined') module.exports = Validator;
