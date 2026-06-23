/** 排班生成：约束优先，尽量满足全部规则 */
const Scheduler = (() => {
  const {
    SHIFT, MEMBERS, getShiftPhases, getShiftForDay, computeShiftPhasesFromState, getDailyMin,
    getRestDays, restDayPreferenceScore,
  } = window.ScheduleConfig;

  const WORK = new Set([SHIFT.Y1, SHIFT.Y2]);

  function isWork(v) { return WORK.has(v); }
  function isOff(v) { return v === SHIFT.OFF; }
  function countOff(row) { return row.filter(isOff).length; }

  function maxRestForDay(dow) {
    const min = getDailyMin(dow);
    return 16 - min.y1 - min.y2;
  }

  function minWorkForDay(dow) {
    const min = getDailyMin(dow);
    return min.y1 + min.y2;
  }

  function prefShift(member, phases, day) {
    if (member.fixedShift) return member.fixedShift;
    return getShiftForDay(phases, day);
  }

  function workStreakBefore(row, d) {
    let n = 0;
    for (let i = d - 1; i >= 0; i--) {
      if (isOff(row[i])) break;
      if (isWork(row[i])) n++;
    }
    return n;
  }

  function countRestOnDay(isRest, day) {
    return MEMBERS.filter(m => isRest[m.name][day]).length;
  }

  function setupPhases(totalDays, options) {
    const phasesMap = {};
    const memberStates = options.memberStates || {};
    for (const m of MEMBERS) {
      phasesMap[m.name] = memberStates[m.name]
        ? computeShiftPhasesFromState(m, memberStates[m.name], totalDays)
        : getShiftPhases(m, totalDays);
    }
    return phasesMap;
  }

  function setupSwitchRest(phasesMap, totalDays) {
    const locked = {};
    for (const m of MEMBERS) {
      locked[m.name] = new Set();
      const phases = phasesMap[m.name];
      if (phases.length > 1) {
        const sw = phases[1].start;
        if (sw >= 2) {
          locked[m.name].add(sw - 2);
          locked[m.name].add(sw - 1);
        }
      } else if (phases.length === 1 && phases[0].start > 0) {
        for (let d = 0; d < phases[0].start; d++) locked[m.name].add(d);
      }
    }
    return locked;
  }

  function initTailStreak(memberStates) {
    const tail = {};
    for (const m of MEMBERS) {
      tail[m.name] = memberStates[m.name]?.tailWorkStreak || 0;
    }
    return tail;
  }

  /** 计算每日休息目标：尽量填满容量，使总休息数最大化 */
  function computeDayRestTargets(totalDays, dayOfWeeks, year, month) {
    const target = new Array(totalDays).fill(0);
    let remaining = MEMBERS.reduce((s, m) => s + getRestDays(m, year, month), 0);
    for (let round = 0; round < totalDays * 3 && remaining > 0; round++) {
      for (let d = 0; d < totalDays; d++) {
        const cap = maxRestForDay(dayOfWeeks[d]);
        if (target[d] < cap && remaining > 0) {
          target[d]++;
          remaining--;
        }
      }
    }
    return target;
  }

  function workStreakFromRest(isRestRow, d, tailAtStart) {
    if (d === 0) return tailAtStart;
    let n = 0;
    for (let i = d - 1; i >= 0; i--) {
      if (isRestRow[i]) break;
      n++;
    }
    return n;
  }

  function shiftCapacityIfRest(isRest, phasesMap, day, excludeName, dayOfWeeks) {
    const min = getDailyMin(dayOfWeeks[day]);
    let y1 = 0;
    let y2 = 0;
    for (const m of MEMBERS) {
      if (m.name === excludeName || isRest[m.name][day]) continue;
      if (m.fixedShift === SHIFT.Y2) y2++;
      else if (prefShift(m, phasesMap[m.name], day) === SHIFT.Y2) y2++;
      else y1++;
    }
    return { y1, y2, min };
  }

  /** 选休息日：优先休「当前班次富余」的人，避免凑不齐人数 */
  function restPickScore(m, d, isRest, phasesMap, dayOfWeeks) {
    const cap = shiftCapacityIfRest(isRest, phasesMap, d, m.name, dayOfWeeks);
    const pref = prefShift(m, phasesMap[m.name], d);
    if (m.fixedShift === SHIFT.Y2) {
      return cap.y2 - cap.min.y2 > 1 ? 0 : 8;
    }
    if (pref === SHIFT.Y2) {
      if (cap.y2 <= cap.min.y2) return 12;
      return cap.y2 - cap.min.y2;
    }
    if (cap.y1 <= cap.min.y1) return 12;
    return cap.y1 - cap.min.y1;
  }

  function canPlaceRest(isRest, locked, m, d, dayOfWeeks, tailStreak) {
    if (isRest[m.name][d] || locked[m.name]?.has(d)) return false;
    if (countRestOnDay(isRest, d) >= maxRestForDay(dayOfWeeks[d])) return false;
    const streak = workStreakFromRest(isRest[m.name], d, tailStreak[m.name]);
    if (streak > 0 && streak < 4) return false;
    return true;
  }

  /** 初始休息：仅换班锁定日 + 软性 7 天 1 休（不强制休息配额） */
  function planRestDays(totalDays, dayOfWeeks, locked, memberStates, phasesMap, variant) {
    const isRest = {};
    const tailStreak = initTailStreak(memberStates);

    for (const m of MEMBERS) {
      isRest[m.name] = new Array(totalDays).fill(false);
      for (const d of locked[m.name] || []) isRest[m.name][d] = true;
    }

    // 软性：7 天内至少 1 休（仅在当日人力有余量时安排）
    const order = MEMBERS.slice().sort((a, b) => ((a.name.charCodeAt(0) + variant) % 16) - ((b.name.charCodeAt(0) + variant) % 16));
    for (const m of order) {
      for (let start = 0; start <= totalDays - 7; start++) {
        let off = 0;
        for (let i = start; i < start + 7; i++) if (isRest[m.name][i]) off++;
        if (off > 0) continue;

        const cands = [];
        for (let d = start; d < start + 7; d++) {
          if (!canPlaceRest(isRest, locked, m, d, dayOfWeeks, tailStreak)) continue;
          const c = shiftCapacityIfRest(isRest, phasesMap, d, m.name, dayOfWeeks);
          const pref = restDayPreferenceScore(m.name, dayOfWeeks[d]);
          const slack = (c.y1 - c.min.y1) + (c.y2 - c.min.y2);
          if (slack < 2) continue;
          cands.push({ d, pref, slack });
        }
        cands.sort((a, b) => a.pref - b.pref || b.slack - a.slack);
        if (cands.length) isRest[m.name][cands[0].d] = true;
      }
    }

    return isRest;
  }

  /** 为当日分配班次：优先满足每日人数，班次阶段仅作偏好 */
  function assignDayShifts(schedule, day, dayOfWeeks, phasesMap, locked) {
    const min = getDailyMin(dayOfWeeks[day]);
    const workers = MEMBERS.filter(m => !isOff(schedule[m.name][day]));
    const flex = workers.filter(m => !m.fixedShift);

    for (const m of workers) schedule[m.name][day] = null;
    for (const m of workers.filter(x => x.fixedShift === SHIFT.Y2)) {
      schedule[m.name][day] = SHIFT.Y2;
    }

    let y2 = workers.filter(m => schedule[m.name][day] === SHIFT.Y2).length;
    const unassigned = () => flex.filter(m => schedule[m.name][day] === null);

    const byPref = (shift) => unassigned().sort((a, b) => {
      const ap = prefShift(a, phasesMap[a.name], day) === shift ? 0 : 1;
      const bp = prefShift(b, phasesMap[b.name], day) === shift ? 0 : 1;
      return ap - bp;
    });

    for (const m of byPref(SHIFT.Y2)) {
      if (y2 >= min.y2) break;
      schedule[m.name][day] = SHIFT.Y2;
      y2++;
    }
    for (const m of unassigned()) {
      if (y2 >= min.y2) break;
      schedule[m.name][day] = SHIFT.Y2;
      y2++;
    }

    let y1 = workers.filter(m => schedule[m.name][day] === SHIFT.Y1).length;
    for (const m of byPref(SHIFT.Y1)) {
      if (y1 >= min.y1) break;
      schedule[m.name][day] = SHIFT.Y1;
      y1++;
    }
    for (const m of unassigned()) {
      if (y1 >= min.y1) break;
      schedule[m.name][day] = SHIFT.Y1;
      y1++;
    }

    for (const m of unassigned()) {
      schedule[m.name][day] = prefShift(m, phasesMap[m.name], day);
    }

    forceDayMin(schedule, day, dayOfWeeks, phasesMap, locked);
  }

  function pullFromRestForShift(schedule, day, shift, phasesMap, locked) {
    const cands = MEMBERS.filter(m => {
      if (!isOff(schedule[m.name][day])) return false;
      if (locked[m.name]?.has(day)) return false;
      if (m.fixedShift) return m.fixedShift === shift;
      return true;
    }).sort((a, b) => {
      const ap = prefShift(a, phasesMap[a.name], day) === shift ? 0 : 1;
      const bp = prefShift(b, phasesMap[b.name], day) === shift ? 0 : 1;
      return ap - bp;
    });

    for (const m of cands) {
      schedule[m.name][day] = m.fixedShift || shift;
      return true;
    }
    return false;
  }

  /** 强制满足当日人数：可取消休息、可跨偏好调班 */
  function forceDayMin(schedule, day, dayOfWeeks, phasesMap, locked) {
    const min = getDailyMin(dayOfWeeks[day]);

    for (let pass = 0; pass < 30; pass++) {
      const c = Validator.countDay(schedule, day);
      if (c.y1 >= min.y1 && c.y2 >= min.y2) return;

      if (c.y1 < min.y1) {
        if (pullFromRestForShift(schedule, day, SHIFT.Y1, phasesMap, locked)) continue;
        const w = MEMBERS.find(m => schedule[m.name][day] === SHIFT.Y2 && !m.fixedShift);
        if (w) { schedule[w.name][day] = SHIFT.Y1; continue; }
      }
      if (c.y2 < min.y2) {
        if (pullFromRestForShift(schedule, day, SHIFT.Y2, phasesMap, locked)) continue;
        const w = MEMBERS.find(m => schedule[m.name][day] === SHIFT.Y1 && !m.fixedShift);
        if (w) { schedule[w.name][day] = SHIFT.Y2; continue; }
      }
      break;
    }
  }

  function fixAllDailyMin(schedule, dayOfWeeks, phasesMap, locked) {
    for (let pass = 0; pass < 20; pass++) {
      let bad = false;
      for (let d = 0; d < dayOfWeeks.length; d++) {
        forceDayMin(schedule, d, dayOfWeeks, phasesMap, locked);
        const min = getDailyMin(dayOfWeeks[d]);
        const c = Validator.countDay(schedule, d);
        if (c.y1 < min.y1 || c.y2 < min.y2) bad = true;
      }
      if (!bad) break;
    }
  }

  /** 仅固定班次 + 换班锁定休息，不强制按阶段覆盖班次 */
  function enforceFixedAndLocked(schedule, totalDays, phasesMap, locked) {
    for (const m of MEMBERS) {
      for (let d = 0; d < totalDays; d++) {
        if (locked[m.name]?.has(d)) {
          schedule[m.name][d] = SHIFT.OFF;
          continue;
        }
        if (m.fixedShift && !isOff(schedule[m.name][d])) {
          schedule[m.name][d] = m.fixedShift;
        }
      }
    }
  }

  /** 软性优化：尽量 7 天 1 休、休前上满 4 天（不破坏每日人数） */
  function softImproveRests(schedule, dayOfWeeks, phasesMap, locked, memberStates) {
    const totalDays = dayOfWeeks.length;
    const tailStreak = initTailStreak(memberStates);

    for (const m of MEMBERS) {
      const row = schedule[m.name];
      for (let d = 0; d < totalDays; d++) {
        if (!isOff(row[d]) || locked[m.name]?.has(d)) continue;
        const wb = d === 0 ? tailStreak[m.name] : workStreakBefore(row, d);
        if (wb > 0 && wb < 4) {
          const shift = prefShift(m, phasesMap[m.name], d);
          row[d] = shift;
        }
      }
    }
    fixAllDailyMin(schedule, dayOfWeeks, phasesMap, locked);

    for (const m of MEMBERS) {
      for (let start = 0; start <= totalDays - 7; start++) {
        let off = 0;
        for (let i = start; i < start + 7; i++) if (isOff(schedule[m.name][i])) off++;
        if (off > 0) continue;

        for (let d = start; d < start + 7; d++) {
          if (locked[m.name]?.has(d)) continue;
          const c = Validator.countDay(schedule, d);
          if (c.off >= maxRestForDay(dayOfWeeks[d])) continue;
          if (c.work <= minWorkForDay(dayOfWeeks[d])) continue;
          const wb = d === 0 ? tailStreak[m.name] : workStreakBefore(schedule[m.name], d);
          if (wb > 0 && wb < 4) continue;
          schedule[m.name][d] = SHIFT.OFF;
          break;
        }
      }
    }
    fixAllDailyMin(schedule, dayOfWeeks, phasesMap, locked);
  }

  function buildSchedule(totalDays, dayOfWeeks, variant, options) {
    const phasesMap = setupPhases(totalDays, options);
    const locked = setupSwitchRest(phasesMap, totalDays);
    const memberStates = options.memberStates || {};
    const isRest = planRestDays(totalDays, dayOfWeeks, locked, memberStates, phasesMap, variant);

    const schedule = {};
    for (const m of MEMBERS) {
      schedule[m.name] = isRest[m.name].map(r => r ? SHIFT.OFF : null);
    }

    for (let d = 0; d < totalDays; d++) {
      assignDayShifts(schedule, d, dayOfWeeks, phasesMap, locked);
    }

    for (let round = 0; round < 3; round++) {
      enforceFixedAndLocked(schedule, totalDays, phasesMap, locked);
      fixAllDailyMin(schedule, dayOfWeeks, phasesMap, locked);
      softImproveRests(schedule, dayOfWeeks, phasesMap, locked, memberStates);
    }
    enforceFixedAndLocked(schedule, totalDays, phasesMap, locked);
    fixAllDailyMin(schedule, dayOfWeeks, phasesMap, locked);

    return { schedule, phasesMap, locked };
  }

  function generate(year, month, variant = 0, options = {}) {
    const meta = window.ScheduleConfig.getMonthMeta(year, month);
    const opts = { ...options, year, month, memberStates: options.memberStates || {} };
    const { schedule, phasesMap } = buildSchedule(meta.days, meta.dayOfWeeks, variant, opts);
    const validation = Validator.validate(schedule, MEMBERS, meta.dayOfWeeks, year, month);
    return { schedule, meta, validation, phasesMap, prevData: options.prevData || null };
  }

  function scoreResult(result) {
    const issues = result.validation.issues;
    let dailyGap = 0;
    let weekly = 0;
    let minWork = 0;
    for (const i of issues) {
      if (i.type === 'dailyMin') dailyGap += (i.need - i.have);
      else if (i.type === 'weeklyRest') weekly++;
      else if (i.type === 'minWorkBeforeRest') minWork++;
    }
    if (dailyGap > 0) return dailyGap * 1e9;
    return weekly * 1000 + minWork * 100;
  }

  function generateBest(year, month, maxAttempts = 80, options = {}) {
    let best = null;
    let bestDaily = null;
    let bestScore = Infinity;

    for (let i = 0; i < maxAttempts; i++) {
      const result = generate(year, month, i, options);
      const dailyFail = result.validation.issues.filter(x => x.type === 'dailyMin').length;
      const score = scoreResult(result);

      if (dailyFail === 0) {
        if (!bestDaily || score < bestScore) {
          bestDaily = result;
          bestScore = score;
        }
      } else if (!bestDaily && score < bestScore) {
        best = result;
        bestScore = score;
      }
      if (bestDaily && score === 0) break;
    }

    const pick = bestDaily || best;
    if (pick) {
      pick.validation = Validator.validate(pick.schedule, MEMBERS, pick.meta.dayOfWeeks, pick.meta.year, pick.meta.month);
    }
    return pick;
  }

  return { generate, generateBest };
})();

if (typeof window !== 'undefined') window.Scheduler = Scheduler;
if (typeof module !== 'undefined') module.exports = Scheduler;
