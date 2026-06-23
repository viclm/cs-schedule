/** 主应用逻辑 */
const App = (() => {
  const { MEMBERS, WEEKDAYS, getRestDays } = window.ScheduleConfig;
  let currentResult = null;
  let prevData = null;
  let storedMonths = [];

  async function init() {
    populateMonthSelect();
    await refreshDataStatus();
    document.getElementById('btn-generate').addEventListener('click', onGenerate);
    document.getElementById('btn-download').addEventListener('click', onDownload);
    onGenerate();
  }

  function populateMonthSelect() {
    const sel = document.getElementById('month-select');
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + 1 + i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const opt = document.createElement('option');
      opt.value = `${y}-${m}`;
      opt.textContent = `${y}年${m}月`;
      if (i === 0) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => refreshDataStatus());
  }

  async function refreshDataStatus() {
    try {
      storedMonths = await Storage.listMonths();
      const { year, month } = parseSelectedMonth();
      const hasTarget = storedMonths.some(m => m.year === year && m.month === month);
      const pm = prevMonthOf(year, month);
      const hasPrev = storedMonths.some(m => m.year === pm.year && m.month === pm.month);

      const el = document.getElementById('data-status');
      const list = storedMonths.map(m => `${m.year}年${m.month}月`).join('、') || '无';
      el.innerHTML = `
        <span>📁 已有数据：${list}</span>
        <span class="${hasPrev ? 'ok' : 'warn'}">${hasPrev ? '✓' : '⚠'} 生成${year}年${month}月依据：${pm.year}年${pm.month}月${hasPrev ? '（已就绪）' : '（缺失）'}</span>
        ${hasTarget ? `<span class="ok">✓ ${year}年${month}月已存档，下载可直接获取</span>` : ''}
      `;
    } catch (e) {
      document.getElementById('data-status').innerHTML =
        `<span class="err">无法连接数据服务，请运行 node server.js</span>`;
    }
  }

  function prevMonthOf(year, month) {
    const d = new Date(year, month - 2, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function parseSelectedMonth() {
    const [y, m] = document.getElementById('month-select').value.split('-').map(Number);
    return { year: y, month: m };
  }

  async function onGenerate() {
    const btn = document.getElementById('btn-generate');
    btn.disabled = true;
    btn.textContent = '生成中…';

    try {
      const { year, month } = parseSelectedMonth();
      prevData = await Storage.loadPrevMonth(year, month);

      const statusEl = document.getElementById('prev-status');
      if (prevData.error) {
        statusEl.innerHTML = `<span class="warn">⚠ ${prevData.error}，将使用默认规则生成</span>`;
        prevData = null;
      } else {
        statusEl.innerHTML = `<span class="ok">✓ 已加载 ${prevData.prevMonth.year}年${prevData.prevMonth.month}月 排班作为依据</span>`;
      }

      const options = prevData ? { memberStates: prevData.memberStates, prevData } : {};

      setTimeout(() => {
        currentResult = Scheduler.generateBest(year, month, 80, options);
        renderSchedule(currentResult);
        renderSummary(currentResult);
        renderPrevContext(prevData);
        btn.disabled = false;
        btn.textContent = '重新生成';
      }, 30);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '生成排班';
      alert('生成失败：' + e.message);
    }
  }

  async function onDownload() {
    if (!currentResult) return;
    const btn = document.getElementById('btn-download');
    btn.disabled = true;
    btn.textContent = '下载中…';
    try {
      const { year, month } = currentResult.meta;
      await Storage.saveAndDownload(year, month, currentResult.schedule, currentResult.meta);
      await refreshDataStatus();
    } catch (e) {
      alert('下载失败：' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '下载';
    }
  }

  function shiftClass(v) {
    if (v === '夜一') return 'shift-y1';
    if (v === '夜二') return 'shift-y2';
    return 'shift-off';
  }

  function renderSchedule(result) {
    const { schedule, meta } = result;
    const { days, dayOfWeeks, year, month } = meta;
    const validation = Validator.validate(schedule, MEMBERS, dayOfWeeks, year, month);
    result.validation = validation;

    const thead = document.getElementById('schedule-head');
    const tbody = document.getElementById('schedule-body');
    const tfoot = document.getElementById('schedule-foot');

    thead.innerHTML = '';
    tbody.innerHTML = '';
    if (tfoot) tfoot.innerHTML = '';

    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th class="name-col">姓名</th>';
    for (let d = 0; d < days; d++) {
      const th = document.createElement('th');
      th.textContent = `${month}/${d + 1}`;
      th.title = WEEKDAYS[dayOfWeeks[d]];
      if (dayOfWeeks[d] === 6) th.style.background = '#f3e8ff';
      if (dayOfWeeks[d] === 0) th.style.background = '#ffedd5';
      headerRow.appendChild(th);
    }
    headerRow.innerHTML += '<th>剩余休</th>';
    thead.appendChild(headerRow);

    const dowRow = document.createElement('tr');
    dowRow.innerHTML = '<th class="name-col"></th>';
    for (let d = 0; d < days; d++) {
      const th = document.createElement('th');
      th.textContent = WEEKDAYS[dayOfWeeks[d]].replace('星期', '周');
      dowRow.appendChild(th);
    }
    dowRow.innerHTML += '<th></th>';
    thead.appendChild(dowRow);

    for (const m of MEMBERS) {
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      nameTd.className = 'name-col';
      nameTd.textContent = m.name;
      tr.appendChild(nameTd);

      let remainingRest = getRestDays(m, year, month);
      for (let d = 0; d < days; d++) {
        const td = document.createElement('td');
        const v = schedule[m.name][d] || '休';
        td.textContent = v;
        td.className = shiftClass(v);
        if (dayOfWeeks[d] === 6) td.classList.add('sat');
        if (dayOfWeeks[d] === 0) td.classList.add('sun');
        if (v === '休') remainingRest--;
        tr.appendChild(td);
      }

      const restTd = document.createElement('td');
      restTd.textContent = Math.max(0, remainingRest);
      tr.appendChild(restTd);
      tbody.appendChild(tr);
    }

    if (tfoot) {
      const summary = Validator.summarize(schedule, dayOfWeeks);
      const mkRow = (label, key, minKey) => {
        const tr = document.createElement('tr');
        tr.className = 'foot-row';
        let html = `<td class="name-col">${label}</td>`;
        for (let d = 0; d < days; d++) {
          const cell = summary.daily[d];
          const val = cell[key];
          const need = cell.min[minKey];
          const bad = val < need;
          html += `<td class="${bad ? 'foot-fail' : 'foot-ok'}">${val}/${need}</td>`;
        }
        html += '<td></td>';
        tr.innerHTML = html;
        tfoot.appendChild(tr);
      };
      mkRow('夜一', 'y1', 'y1');
      mkRow('夜二', 'y2', 'y2');
    }

    const statusEl = document.getElementById('validation-status');
    const groups = Validator.groupIssues(validation.issues);
    const dailyFail = groups.dailyMin || 0;
    if (validation.valid) {
      statusEl.innerHTML = '<span class="ok">✓ 每日人数已全部达标</span>';
    } else if (dailyFail === 0) {
      statusEl.innerHTML = '<span class="ok">✓ 每日人数已全部达标</span>';
    } else {
      statusEl.innerHTML = `<span class="err">✗ 每日人数不足 ${dailyFail} 处，请重新生成</span>`;
    }
  }

  function renderPrevContext(prev) {
    const el = document.getElementById('prev-context');
    if (!prev || !prev.memberStates) {
      el.innerHTML = '<div class="muted">无上月数据参考</div>';
      return;
    }
    el.innerHTML = MEMBERS.map(m => {
      const s = prev.memberStates[m.name];
      if (!s) return '';
      return `<div>${m.name}: 末班 ${s.lastDayStatus || '-'}，当前阶段 ${s.prevShift || '-'} ${s.phaseDays}天</div>`;
    }).join('');
  }

  function renderSummary(result) {
    const { schedule, meta } = result;
    const summary = Validator.summarize(schedule, meta.dayOfWeeks);

    document.getElementById('daily-summary').innerHTML = summary.daily.map(d => {
      const cls = d.ok ? 'daily-row-ok' : 'daily-row-fail';
      const note = d.ok ? '' : ' ← 未达标';
      return `<div class="${cls}">${d.day}日(${d.dow}) 夜一 ${d.y1}/${d.min.y1}，夜二 ${d.y2}/${d.min.y2}${note}</div>`;
    }).join('');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
