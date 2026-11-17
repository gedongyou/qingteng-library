/* 后台通用 UI 工具：状态标签、表格、分页、表单弹层、CSV 下载 */
import { $, modal, escapeHtml, fmtDate, toast, api } from './common.js';

export const ST = {
  available: ['在架', 'st-available'],
  borrowed: ['借出', 'st-borrowed'],
  reserved: ['预留', 'st-reserved'],
  lost: ['遗失', 'st-lost'],
  repair: ['修补', 'st-repair'],
  ready: ['已到书', 'st-ready'],
  waiting: ['排队中', 'st-waiting'],
  fulfilled: ['已借出', 'st-returned'],
  returned: ['已归还', 'st-returned'],
  cancelled: ['已取消', 'st-cancelled'],
  expired: ['已过期', 'st-expired'],
  active: ['正常', 'st-available'],
  frozen: ['已冻结', 'st-lost'],
};

export function badge(key, text) {
  const [label, cls] = ST[key] || [key, 'st-borrowed'];
  return `<span class="pill-status ${cls}">${escapeHtml(text || label)}</span>`;
}

export function overdueBadge(days) {
  return days > 0 ? `<span class="pill-status st-overdue">逾期 ${days} 天</span>` : '';
}

/** 通用表格：columns = [{key,title,render?,cls?}] */
export function table(columns, rows, { empty = '没有数据' } = {}) {
  if (!rows.length) {
    return `<div class="empty">${escapeHtml(empty)}</div>`;
  }
  return `<div class="table-wrap"><table class="data">
    <thead><tr>${columns.map((c) => `<th ${c.cls ? `class="${c.cls}"` : ''}>${c.title}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => {
      const v = c.render ? c.render(r) : escapeHtml(r[c.key] ?? '—');
      return `<td ${c.cls ? `class="${c.cls}"` : ''}>${v}</td>`;
    }).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

/** 分页条 */
export function pager(data, onGo) {
  const el = document.createElement('div');
  el.className = 'pager';
  if (data.pages <= 1) return el;
  const cur = data.page;
  let start = Math.max(1, cur - 2);
  let end = Math.min(data.pages, start + 4);
  start = Math.max(1, end - 4);
  let html = `<button data-p="${cur - 1}" ${cur <= 1 ? 'disabled' : ''}>‹</button>`;
  if (start > 1) { html += `<button data-p="1">1</button>`; if (start > 2) html += `<span class="info">…</span>`; }
  for (let p = start; p <= end; p++) {
    html += `<button data-p="${p}" ${p === cur ? 'aria-current="true"' : ''}>${p}</button>`;
  }
  if (end < data.pages) {
    if (end < data.pages - 1) html += `<span class="info">…</span>`;
    html += `<button data-p="${data.pages}">${data.pages}</button>`;
  }
  html += `<button data-p="${cur + 1}" ${cur >= data.pages ? 'disabled' : ''}>›</button>`;
  html += `<span class="info">共 ${data.total} 条</span>`;
  el.innerHTML = html;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b || b.disabled) return;
    onGo(Number(b.dataset.p));
  });
  return el;
}

/**
 * 表单弹层
 * fields: [{name,label,type,required,options,value,placeholder,full,hint,min,max,step,rows}]
 * 返回提交后的结果（调用方负责 refresh），取消返回 null
 */
export function formModal({ title, fields, submitText = '保存', width = 620, onSubmit, extraHtml = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const form = document.createElement('form');
    form.className = 'form-grid';
    form.innerHTML = fields.map((f) => {
      const v = f.value ?? '';
      const full = f.full ? ' full' : '';
      const req = f.required ? 'required' : '';
      let ctrl;
      if (f.type === 'select') {
        ctrl = `<select class="select" name="${f.name}" ${req}>${(f.options || [])
          .map((o) => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`)
          .join('')}</select>`;
      } else if (f.type === 'textarea') {
        ctrl = `<textarea class="textarea" name="${f.name}" rows="${f.rows || 4}" ${req}
          placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(v)}</textarea>`;
      } else if (f.type === 'checkbox') {
        ctrl = `<label style="display:flex;align-items:center;gap:7px;height:38px">
          <input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> <span class="small">${escapeHtml(f.hint || '')}</span></label>`;
      } else {
        ctrl = `<input class="input" type="${f.type || 'text'}" name="${f.name}" value="${escapeHtml(v)}"
          ${req} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}
          ${f.step ? `step="${f.step}"` : ''} placeholder="${escapeHtml(f.placeholder || '')}">`;
      }
      return `<div class="field${full}"><label>${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>${ctrl}
        ${f.hint && f.type !== 'checkbox' ? `<span class="small muted">${escapeHtml(f.hint)}</span>` : ''}</div>`;
    }).join('') + extraHtml;

    const footer = document.createElement('div');
    footer.innerHTML = `<button type="button" class="btn btn-ghost" data-cancel>取消</button>
      <button type="submit" class="btn">${escapeHtml(submitText)}</button>`;

    const m = modal({
      title, content: form, footer, width,
      onClose: () => { if (!done) resolve(null); },
    });
    m.el.querySelector('[data-cancel]').onclick = () => m.close();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = {};
      for (const f of fields) {
        if (f.type === 'checkbox') body[f.name] = fd.get(f.name) === 'on';
        else if (f.type === 'number') body[f.name] = fd.get(f.name) === '' ? null : Number(fd.get(f.name));
        else body[f.name] = fd.get(f.name);
      }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const out = onSubmit ? await onSubmit(body) : body;
        done = true;
        resolve(out ?? body);
        m.close();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
    setTimeout(() => form.querySelector('input,select,textarea')?.focus(), 60);
  });
}

/** 下载后台导出的 CSV —— 纯静态版：CSV 在浏览器里生成，直接触发下载 */
export async function exportCsv(type) {
  try {
    const r = await api('/api/admin/export?type=' + type);
    const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8' });
    const name = r.filename || `导出-${type}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出 ' + name, 'ok');
  } catch (err) {
    toast(err.message || '导出失败', 'error');
  }
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export { $, api, escapeHtml, fmtDate, toast };
