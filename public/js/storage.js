/** 客户端数据层：对接本地 Excel 微型数据库 */
const Storage = (() => {
  const API = '/api';

  async function listMonths() {
    const res = await fetch(`${API}/months`);
    if (!res.ok) throw new Error('无法读取排班库');
    const data = await res.json();
    return data.months;
  }

  async function loadMonth(year, month) {
    const res = await fetch(`${API}/months/${year}/${month}`);
    if (!res.ok) return null;
    return res.json();
  }

  async function loadPrevMonth(year, month) {
    const res = await fetch(`${API}/prev/${year}/${month}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { error: err.error || '缺少上月排班', prevMonth: err.prevMonth };
    }
    return res.json();
  }

  async function saveMonth(year, month, schedule, meta) {
    const res = await fetch(`${API}/months/${year}/${month}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schedule,
        days: meta.days,
        dayOfWeeks: meta.dayOfWeeks,
      }),
    });
    if (!res.ok) throw new Error('保存失败');
    return res.json();
  }

  async function downloadMonth(year, month) {
    const res = await fetch(`${API}/months/${year}/${month}/download`);
    if (!res.ok) throw new Error('下载失败');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${year}年${month}月客服排班.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** 保存并下载 */
  async function saveAndDownload(year, month, schedule, meta) {
    await saveMonth(year, month, schedule, meta);
    await downloadMonth(year, month);
  }

  return { listMonths, loadMonth, loadPrevMonth, saveMonth, downloadMonth, saveAndDownload };
})();

if (typeof window !== 'undefined') window.Storage = Storage;
