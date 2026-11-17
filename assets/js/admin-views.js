/* ===========================================================
   管理后台各视图
   =========================================================== */
import {
  $, api, modal, escapeHtml, fmtDate, fmtDateTime, toast, confirmDialog, roleName,
} from './common.js';
import {
  table, pager, formModal, exportCsv, badge, debounce, ST,
} from './admin-ui.js';

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const overdueDays = (due) => Math.max(0, Math.ceil((Date.now() - new Date(due)) / 864e5));

/* ==================== 仪表盘 ==================== */
export async function dashboard(root) {
  const d = await api('/api/admin/dashboard');
  const { stats, trend, byCategory, hot, recentLogs, rules } = d;

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>仪表盘</h1>
        <p class="desc">今天是 ${new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
          · 借期 ${rules.borrowDays} 天 · 逾期费 ￥${rules.finePerDay}/天</p>
      </div>
      <div class="view-actions">
        <button class="btn btn-sm btn-ghost" data-go="circulation">去借还办理</button>
        <button class="btn btn-sm" data-go="books" data-add="1">新增图书</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi accent">
        <div class="label">今日借出</div>
        <div class="value">${stats.todayBorrow}</div>
        <div class="foot">归还 ${stats.todayReturn} 册</div>
      </div>
      <div class="kpi">
        <div class="label">当前外借</div>
        <div class="value">${stats.borrowing}</div>
        <div class="foot">在架 <b>${stats.available}</b> 册</div>
      </div>
      <div class="kpi ${stats.overdue ? 'warn' : ''}">
        <div class="label">逾期未还</div>
        <div class="value">${stats.overdue}</div>
        <div class="foot">${stats.overdue ? '需要催还' : '全部按时'}</div>
      </div>
      <div class="kpi">
        <div class="label">预约待处理</div>
        <div class="value">${stats.reserved}</div>
        <div class="foot">排队 ${stats.waiting} 人</div>
      </div>
      <div class="kpi">
        <div class="label">读者</div>
        <div class="value">${stats.readers}</div>
        <div class="foot">图书 ${stats.books} 种 / ${stats.copies} 册</div>
      </div>
      <div class="kpi">
        <div class="label">遗失 / 修补</div>
        <div class="value">${stats.lost}</div>
        <div class="foot">需盘点时核对</div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="dash-col">
        <section class="panel">
          <div class="panel-head">
            <h2>近 14 天借还趋势</h2>
            <div class="chart-legend">
              <span><i style="background:#2c6b58"></i>借出</span>
              <span><i style="background:#d9a15e"></i>归还</span>
            </div>
          </div>
          <div class="panel-body chart-wrap">${trendChart(trend)}</div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>借阅最多的图书</h2>
            <button class="btn btn-sm btn-ghost" data-go="books">全部图书</button></div>
          <div class="panel-body" style="padding-top:6px">
            ${table([
              { title: '#', render: (r, i) => '' },
              { title: '书名', render: (r) => `<span class="title-cell"><a href="book.html?id=${r.id}" target="_blank">${escapeHtml(r.title)}</a><small>${escapeHtml(r.author || '')}</small></span>` },
              { title: '借出次数', cls: 'ops', render: (r) => `<b>${r.times}</b> 次` },
            ], hot, { empty: '还没有借阅记录' })}
          </div>
        </section>
      </div>

      <div class="dash-col">
        <section class="panel">
          <div class="panel-head"><h2>分类馆藏</h2></div>
          <div class="panel-body">
            <div class="cat-bars">
              ${byCategory.filter((c) => c.books > 0).slice(0, 10).map((c) => {
                const max = Math.max(...byCategory.map((x) => x.books), 1);
                return `<div class="cat-bar">
                  <span class="name">${escapeHtml(c.name)}</span>
                  <span class="track"><span class="fill" style="width:${(c.books / max) * 100}%"></span></span>
                  <span class="num">${c.books}</span>
                </div>`;
              }).join('')}
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>快捷操作</h2></div>
          <div class="panel-body" style="display:flex;flex-direction:column;gap:8px">
            <button class="btn btn-ghost btn-block" data-go="circulation">扫码借还</button>
            <button class="btn btn-ghost btn-block" data-go="reservations">处理预约到书</button>
            <button class="btn btn-ghost btn-block" data-go="readers" data-add="1">登记新读者</button>
            <button class="btn btn-ghost btn-block" data-go="notices" data-add="1">发布公告</button>
            <button class="btn btn-ghost btn-block" data-export="borrows">导出借阅流水</button>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>最近操作</h2>
            <button class="btn btn-sm btn-ghost" data-go="logs">全部</button></div>
          <div class="panel-body" style="padding-top:4px">
            <ul class="mini-list">
              ${recentLogs.map((l) => `<li>
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.detail || l.action)}</span>
                <span class="due">${fmtDateTime(l.at)}</span></li>`).join('')}
            </ul>
          </div>
        </section>
      </div>
    </div>`;
}

function trendChart(trend) {
  const W = 760, H = 230, pad = { t: 14, r: 10, b: 26, l: 30 };
  const max = Math.max(...trend.map((d) => Math.max(d.borrow, d.return)), 4);
  const step = (W - pad.l - pad.r) / trend.length;
  const bw = Math.min(14, step / 3);
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const ticks = 4;
  let g = '';
  for (let i = 0; i <= ticks; i++) {
    const v = Math.round((max / ticks) * i);
    const yy = y(v);
    g += `<line class="grid-line" x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}"/>
          <text class="axis-text" x="${pad.l - 7}" y="${yy + 3.5}" text-anchor="end">${v}</text>`;
  }
  const bars = trend.map((d, i) => {
    const x = pad.l + i * step + step / 2;
    const b1 = y(d.borrow), b2 = y(d.return);
    const label = i % 2 === 0 ? d.date.slice(5) : '';
    return `<g>
      <rect class="bar-b" x="${x - bw - 1.5}" y="${b1}" width="${bw}" height="${H - pad.b - b1}" rx="2"><title>${d.date} 借出 ${d.borrow}</title></rect>
      <rect class="bar-r" x="${x + 1.5}" y="${b2}" width="${bw}" height="${H - pad.b - b2}" rx="2"><title>${d.date} 归还 ${d.return}</title></rect>
      <text class="axis-text" x="${x}" y="${H - 8}" text-anchor="middle">${label}</text>
    </g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="近14天借还趋势">${g}${bars}</svg>`;
}

/* ==================== 借还办理 ==================== */
export async function circulation(root) {
  root.innerHTML = `
    <div class="view-head">
      <div><h1>借还办理</h1>
        <p class="desc">刷借书证或图书条码，自动识别「这本书／这位读者」，一次完成借出与归还。</p></div>
      <div class="view-actions">
        <button class="btn btn-sm btn-ghost" data-go="borrows">借阅记录</button>
      </div>
    </div>

    <div class="circ-grid">
      <section class="panel">
        <div class="panel-head"><h2>扫码 / 输入</h2></div>
        <div class="panel-body scan-box">
          <div class="field">
            <label for="scan-card">借书证号 / 学号 / 姓名</label>
            <input class="input scan-input" id="scan-card" placeholder="如 2023010101 或 陈嘉禾" autocomplete="off">
          </div>
          <div class="field">
            <label for="scan-code">图书条码 / ISBN</label>
            <input class="input scan-input" id="scan-code" placeholder="如 B6081-002-01" autocomplete="off">
          </div>
          <p class="scan-hint">
            <kbd>Enter</kbd> 在任一输入框提交；条码框为空时按书名关键字选择图书。
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" id="do-borrow" style="flex:1">办理借出</button>
            <button class="btn btn-clay" id="do-return" style="flex:1">办理归还</button>
          </div>
          <hr class="divider">
          <div id="quick-books"></div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>识别结果</h2>
          <span class="small muted" id="lookup-time"></span></div>
        <div class="panel-body">
          <div class="lookup-card" id="lookup-card">
            <div class="lookup-empty">扫码后这里会显示读者与图书信息</div>
          </div>
          <div id="lookup-extra" style="margin-top:12px"></div>
        </div>
      </section>
    </div>`;

  const cardEl = $('#scan-card');
  const codeEl = $('#scan-code');
  const cardBox = $('#lookup-card');
  const extra = $('#lookup-extra');

  let currentUser = null;
  let currentCopy = null;
  let currentBook = null;

  async function lookup(which) {
    const code = which === 'card' ? cardEl.value.trim() : codeEl.value.trim();
    if (!code) return;
    try {
      const r = await api('/api/admin/lookup?code=' + encodeURIComponent(code));
      $('#lookup-time').textContent = new Date().toLocaleTimeString('zh-CN');
      if (!r) {
        toast(`没有找到「${code}」对应的读者或图书`, 'error');
        return;
      }
      if (r.type === 'user') {
        currentUser = r.user;
        cardBox.innerHTML = `
          <div class="who">
            <span class="avatar">${escapeHtml(r.user.name.slice(-1))}</span>
            <div><b>${escapeHtml(r.user.name)}</b>
              <span>${escapeHtml(r.user.cardNo)} · ${escapeHtml(r.user.dept || '')}</span></div>
            <span style="margin-left:auto">${badge(r.user.status)}</span>
          </div>
          <div class="small muted">在借 ${r.stats.active} / ${r.user.maxBorrow || r.stats.active + 1} 册
            ${r.stats.overdue ? ` · <span style="color:var(--danger)">逾期 ${r.stats.overdue} 册</span>` : ''}</div>
          ${r.active.length ? `<ul class="mini-list">${r.active.map((a) => `
            <li class="${new Date(a.dueAt) < new Date() ? 'over' : ''}">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.title)}</span>
              <span class="due">应还 ${fmtDate(a.dueAt)}</span></li>`).join('')}</ul>` : '<p class="small muted" style="margin:10px 0 0">当前没有在借图书</p>'}`;
        extra.innerHTML = '';
      } else if (r.type === 'copy') {
        currentCopy = r.copy;
        currentBook = { id: r.copy.bookId, title: r.copy.title, author: r.copy.author };
        cardBox.innerHTML = `
          <div class="who">
            <span class="avatar">书</span>
            <div><b>${escapeHtml(r.copy.title)}</b>
              <span>${escapeHtml(r.copy.author || '')}</span></div>
            <span style="margin-left:auto">${badge(r.copy.status)}</span>
          </div>
          <div class="small muted">条码 <span class="mono">${escapeHtml(r.copy.barcode)}</span>
            · 同书在架 ${r.stock.available} / ${r.stock.total} 册</div>
          ${r.borrow ? `<ul class="mini-list"><li class="${new Date(r.borrow.dueAt) < new Date() ? 'over' : ''}">
              <span>借阅人：${escapeHtml(r.borrow.name)}（${escapeHtml(r.borrow.cardNo)}）</span>
              <span class="due">应还 ${fmtDate(r.borrow.dueAt)}</span></li></ul>`
            : '<p class="small muted" style="margin:10px 0 0">这一册当前在架</p>'}`;
        if (r.borrow) cardEl.value = r.borrow.cardNo;
        extra.innerHTML = '';
      } else if (r.type === 'book') {
        currentBook = r.book;
        cardBox.innerHTML = `
          <div class="who">
            <span class="avatar">书</span>
            <div><b>${escapeHtml(r.book.title)}</b><span>${escapeHtml(r.book.author || '')} · ISBN ${escapeHtml(r.book.isbn || '')}</span></div>
          </div>
          <div class="small muted">在架 ${r.book.available} / ${r.book.total} 册</div>`;
        extra.innerHTML = `<div class="copy-chips">${r.copies.map((c) => `
          <button class="copy-chip ${c.status}" data-copy="${escapeHtml(c.barcode)}">
            ${escapeHtml(c.barcode)} <span class="st">${ST[c.status]?.[0] || c.status}</span></button>`).join('')}</div>`;
        extra.addEventListener('click', (e) => {
          const b = e.target.closest('[data-copy]');
          if (b) { codeEl.value = b.dataset.copy; lookup('code'); }
        }, { once: true });
      }
    } catch (err) { toast(err.message, 'error'); }
  }

  cardEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookup('card'); } });
  codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookup('code'); } });
  cardEl.addEventListener('blur', () => { if (cardEl.value.trim()) lookup('card'); });
  codeEl.addEventListener('blur', () => { if (codeEl.value.trim()) lookup('code'); });

  $('#do-borrow').onclick = async (e) => {
    const btn = e.currentTarget;
    if (!cardEl.value.trim()) { toast('请先输入借书证号', 'error'); cardEl.focus(); return; }
    btn.disabled = true;
    try {
      const r = await api('/api/admin/circulation/borrow', {
        method: 'POST',
        body: { cardNo: cardEl.value.trim(), barcode: codeEl.value.trim() || undefined, bookId: currentBook?.id },
      });
      toast(`已借出《${r.bookTitle}》给 ${r.userName}，应还 ${fmtDate(r.dueAt)}`, 'ok');
      cardEl.value = ''; codeEl.value = ''; cardBox.innerHTML = '<div class="lookup-empty">扫码后这里会显示读者与图书信息</div>';
      extra.innerHTML = ''; cardEl.focus();
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  };

  $('#do-return').onclick = async (e) => {
    const btn = e.currentTarget;
    const code = codeEl.value.trim();
    if (!code) { toast('请把图书条码扫入第二个输入框', 'error'); codeEl.focus(); return; }
    btn.disabled = true;
    try {
      const r = await api('/api/admin/circulation/return', { method: 'POST', body: { barcode: code } });
      toast(r.overdueDays
        ? `已归还《${r.bookTitle}》，逾期 ${r.overdueDays} 天，应缴 ￥${r.fine}`
        : `已归还《${r.bookTitle}》，按时归还`, r.overdueDays ? '' : 'ok');
      codeEl.value = ''; cardBox.innerHTML = '<div class="lookup-empty">扫码后这里会显示读者与图书信息</div>';
      extra.innerHTML = ''; codeEl.focus();
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  };

  // 快捷：今日到期 / 逾期列表
  const circ = await api('/api/admin/circulation?status=overdue');
  $('#quick-books').innerHTML = `
    <p class="small muted" style="margin:0 0 8px">逾期未还 ${circ.stats.overdue} 册，点击可快速定位：</p>
    <ul class="mini-list">
      ${circ.items.slice(0, 5).map((b) => `<li class="${overdueDays(b.dueAt) ? 'over' : ''}">
        <span>${escapeHtml(b.title)} · ${escapeHtml(b.name)}</span>
        <span class="due">逾期 ${overdueDays(b.dueAt)} 天</span></li>`).join('') || '<li>没有逾期图书</li>'}
    </ul>`;
}

/* ==================== 借阅记录 ==================== */
export async function borrows(root) {
  let status = 'borrowed';
  let page = 1;

  root.innerHTML = `
    <div class="view-head">
      <div><h1>借阅记录</h1><p class="desc">所有借出与归还流水；逾期记录可直接续借或标记归还。</p></div>
      <div class="view-actions">
        <div class="seg" id="seg">
          <button data-s="borrowed" class="on">在借</button>
          <button data-s="overdue">逾期</button>
          <button data-s="returned">已归还</button>
          <button data-s="all">全部</button>
        </div>
        <button class="btn btn-sm btn-ghost" data-export="borrows">导出 CSV</button>
      </div>
    </div>
    <section class="panel"><div id="table"></div><div id="pager-host" style="padding:0 18px"></div></section>`;

  async function load() {
    $('#table').innerHTML = '<div class="empty">加载中…</div>';
    const d = await api(`/api/admin/circulation?status=${status}`);
    const rows = d.items;
    $('#table').innerHTML = table([
      { title: '读者', render: (r) => `<span class="title-cell"><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.cardNo)} · ${escapeHtml(r.dept || '')}</small></span>` },
      { title: '图书', render: (r) => `<span class="title-cell"><a href="book.html?id=${r.bookId}" target="_blank">${escapeHtml(r.title)}</a><small class="mono">${escapeHtml(r.barcode)}</small></span>` },
      { title: '借出', render: (r) => `<span class="small">${fmtDate(r.borrowedAt)}</span>` },
      { title: '应还', render: (r) => `<span class="small">${fmtDate(r.dueAt)}</span>` },
      { title: '状态', render: (r) => {
        if (r.status === 'returned') return badge('returned');
        const od = overdueDays(r.dueAt);
        return od ? badge('overdue', `逾期 ${od} 天`) : badge('borrowed');
      } },
      { title: '续借', render: (r) => `${r.renewCount} 次` },
      { title: '操作', cls: 'ops', render: (r) => r.status === 'borrowed'
        ? `<button class="btn btn-sm btn-ghost" data-renew="${r.id}">续借</button>
           <button class="btn btn-sm" data-return="${r.id}">归还</button>` : '—' },
    ], rows, { empty: '没有符合条件的记录' });
    $('#pager-host').innerHTML = '';
  }

  $('#seg').onclick = (e) => {
    const b = e.target.closest('button[data-s]');
    if (!b) return;
    $('#seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    status = b.dataset.s;
    load();
  };

  root.addEventListener('click', async (e) => {
    const rn = e.target.closest('[data-renew]');
    if (rn) {
      rn.disabled = true;
      try {
        const r = await api('/api/admin/circulation/renew', { method: 'POST', body: { borrowId: Number(rn.dataset.renew) } });
        toast(`续借成功，应还 ${fmtDate(r.dueAt)}`, 'ok');
        load();
      } catch (err) { toast(err.message, 'error'); rn.disabled = false; }
      return;
    }
    const rt = e.target.closest('[data-return]');
    if (rt) {
      rt.disabled = true;
      try {
        const r = await api('/api/admin/circulation/return', { method: 'POST', body: { borrowId: Number(rt.dataset.return) } });
        toast(r.overdueDays ? `已归还，逾期 ${r.overdueDays} 天，应缴 ￥${r.fine}` : '已归还', 'ok');
        load();
      } catch (err) { toast(err.message, 'error'); rt.disabled = false; }
    }
  });

  await load();
}

/* ==================== 预约管理 ==================== */
export async function reservations(root) {
  let status = 'active';

  root.innerHTML = `
    <div class="view-head">
      <div><h1>预约管理</h1>
        <p class="desc">按排队顺序处理到书；「已到书」的读者会保留若干天取书，逾期未取系统自动顺延给下一位。</p></div>
      <div class="view-actions">
        <div class="seg" id="seg">
          <button data-s="active" class="on">进行中</button>
          <button data-s="ready">已到书</button>
          <button data-s="all">全部</button>
        </div>
      </div>
    </div>
    <section class="panel"><div id="table"></div></section>`;

  async function load() {
    $('#table').innerHTML = '<div class="empty">加载中…</div>';
    const rows = await api('/api/admin/reservations?status=' + status);
    $('#table').innerHTML = table([
      { title: '读者', render: (r) => `<span class="title-cell"><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.cardNo)}</small></span>` },
      { title: '图书', render: (r) => `<span class="title-cell"><a href="book.html?id=${r.bookId}" target="_blank">${escapeHtml(r.title)}</a><small>${escapeHtml(r.author || '')}</small></span>` },
      { title: '队号', render: (r) => `<b class="mono">${r.queueNo}</b>` },
      { title: '状态', render: (r) => badge(r.status) },
      { title: '预约时间', render: (r) => `<span class="small">${fmtDate(r.createdAt)}</span>` },
      { title: '到书 / 截止', render: (r) => r.status === 'ready'
        ? `<span class="small">到书 ${fmtDate(r.readyAt)}<br>截止 <b style="color:var(--clay)">${fmtDate(r.expireAt)}</b></span>` : '—' },
      { title: '操作', cls: 'ops', render: (r) => {
        if (r.status === 'ready') return `<button class="btn btn-sm" data-fulfil="${r.id}">办理借出</button>
          <button class="btn btn-sm btn-ghost" data-cancel="${r.id}">取消</button>`;
        if (r.status === 'waiting') return `<button class="btn btn-sm btn-ghost" data-ready="${r.id}">置为到书</button>
          <button class="btn btn-sm btn-ghost" data-cancel="${r.id}">取消</button>`;
        return '—';
      } },
    ], rows, { empty: '没有预约记录' });
  }

  $('#seg').onclick = (e) => {
    const b = e.target.closest('button[data-s]');
    if (!b) return;
    $('#seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    status = b.dataset.s;
    load();
  };

  root.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-fulfil]');
    if (f) {
      f.disabled = true;
      try {
        const r = await api(`/api/admin/reservations/${f.dataset.fulfil}/fulfill`, { method: 'POST' });
        toast(`已借出，应还 ${fmtDate(r.dueAt)}`, 'ok');
        load();
      } catch (err) { toast(err.message, 'error'); f.disabled = false; }
      return;
    }
    const rd = e.target.closest('[data-ready]');
    if (rd) {
      rd.disabled = true;
      try {
        await api(`/api/admin/reservations/${rd.dataset.ready}/ready`, { method: 'POST' });
        toast('已置为「到书」，副本已为该读者锁定', 'ok');
        load();
      } catch (err) { toast(err.message, 'error'); rd.disabled = false; }
      return;
    }
    const c = e.target.closest('[data-cancel]');
    if (c) {
      const ok = await confirmDialog('取消这条预约？预留副本会顺延给下一位。', { okText: '取消预约', danger: true });
      if (!ok) return;
      try {
        await api(`/api/admin/reservations/${c.dataset.cancel}/cancel`, { method: 'POST' });
        toast('已取消', 'ok');
        load();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  await load();
}

/* ==================== 图书管理 ==================== */
export async function books(root, { add = false } = {}) {
  const state = { keyword: '', category: '', stock: '', page: 1, size: 15 };
  const cats = await api('/api/admin/categories');

  root.innerHTML = `
    <div class="view-head">
      <div><h1>图书管理</h1><p class="desc">书目 + 副本两级管理：一种书可有多册，每册独立条码与状态。</p></div>
      <div class="view-actions">
        <button class="btn btn-sm btn-ghost" data-export="books">导出图书台账</button>
        <button class="btn btn-sm" id="add-book">新增图书</button>
      </div>
    </div>
    <section class="panel">
      <div class="panel-head">
        <div class="panel-toolbar">
          <input class="input" id="kw" placeholder="书名 / 作者 / ISBN" style="width:230px">
          <select class="select" id="cat" style="width:150px"><option value="">全部分类</option>
            ${cats.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>
          <select class="select" id="stock" style="width:130px">
            <option value="">全部库存</option><option value="out">仅看无在架</option></select>
        </div>
        <span class="small muted" id="count"></span>
      </div>
      <div id="table"></div><div id="pager-host" style="padding:0 18px"></div>
    </section>`;

  async function load() {
    $('#table').innerHTML = '<div class="empty">加载中…</div>';
    const qs = new URLSearchParams({ page: state.page, size: state.size });
    if (state.keyword) qs.set('keyword', state.keyword);
    if (state.category) qs.set('category', state.category);
    if (state.stock) qs.set('stock', state.stock);
    const d = await api('/api/admin/books?' + qs);
    $('#count').textContent = `共 ${d.total} 种`;
    $('#table').innerHTML = table([
      { title: '书名', render: (b) => `<span class="title-cell"><a href="book.html?id=${b.id}" target="_blank">${escapeHtml(b.title)}</a>
        <small class="mono">${escapeHtml(b.isbn || '—')} · ${escapeHtml(b.author || '')}</small></span>` },
      { title: '分类', render: (b) => `<span class="small">${escapeHtml(b.category || '—')}</span>` },
      { title: '馆藏', render: (b) => `<span class="small">${b.total} 册</span>` },
      { title: '在架', render: (b) => b.available > 0
        ? `<span class="tag tag-green">${b.available}</span>` : `<span class="tag tag-clay">0</span>` },
      { title: '位置', render: (b) => `<span class="small muted mono">${escapeHtml(b.location || '—')}</span>` },
      { title: '操作', cls: 'ops', render: (b) => `
        <button class="btn btn-sm btn-ghost" data-copies="${b.id}">副本</button>
        <button class="btn btn-sm btn-ghost" data-edit="${b.id}">编辑</button>` },
    ], d.items, { empty: '没有符合条件的图书' });
    $('#pager-host').innerHTML = '';
    $('#pager-host').appendChild(pager(d, (p) => { state.page = p; load(); }));
  }

  $('#kw').value = state.keyword;
  $('#kw').addEventListener('input', debounce((e) => { state.keyword = e.target.value.trim(); state.page = 1; load(); }));
  $('#cat').onchange = (e) => { state.category = e.target.value; state.page = 1; load(); };
  $('#stock').onchange = (e) => { state.stock = e.target.value; state.page = 1; load(); };
  $('#add-book').onclick = () => openBookForm(cats, null, load);

  root.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const d = await api('/api/admin/books/' + ed.dataset.edit + '/copies');
      openBookForm(cats, d.book, load);
      return;
    }
    const cp = e.target.closest('[data-copies]');
    if (cp) openCopies(Number(cp.dataset.copies), load);
  });

  await load();
  if (add) $('#add-book').click();
}

function openBookForm(cats, book, done) {
  const isNew = !book;
  formModal({
    title: isNew ? '新增图书' : '编辑图书',
    submitText: isNew ? '创建并生成副本' : '保存修改',
    width: 700,
    fields: [
      { name: 'title', label: '书名', required: true, value: book?.title, full: true },
      { name: 'author', label: '作者', value: book?.author },
      { name: 'isbn', label: 'ISBN', value: book?.isbn, hint: '副本条码会用到后四位' },
      { name: 'publisher', label: '出版社', value: book?.publisher },
      { name: 'pubYear', label: '出版年', type: 'number', value: book?.pubYear },
      { name: 'categoryId', label: '分类', type: 'select', value: book?.categoryId,
        options: [{ value: '', label: '未分类' }, ...cats.map((c) => ({ value: c.id, label: c.name }))] },
      { name: 'price', label: '定价（元）', type: 'number', step: '0.01', value: book?.price },
      { name: 'location', label: '馆藏位置', value: book?.location, placeholder: 'A区-1排-01架' },
      { name: 'tags', label: '标签', value: book?.tags, hint: '逗号分隔，用于检索' },
      { name: 'summary', label: '内容简介', type: 'textarea', value: book?.summary, full: true },
      ...(isNew ? [{ name: 'copies', label: '初始副本数', type: 'number', value: 1, min: 1, max: 50, hint: '每册自动生成条码' }] : []),
    ],
    onSubmit: async (body) => {
      if (isNew) {
        await api('/api/admin/books', { method: 'POST', body });
        toast('图书已创建，副本条码已生成', 'ok');
      } else {
        await api('/api/admin/books/' + book.id, { method: 'PUT', body });
        toast('已保存', 'ok');
      }
      done();
    },
  });
}

async function openCopies(bookId, refresh) {
  const d = await api(`/api/admin/books/${bookId}/copies`);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="small muted" style="margin-bottom:10px">
      《${escapeHtml(d.book.title)}》共 ${d.copies.length} 册，在架 ${d.book.available} 册
    </div>
    <div class="table-wrap" style="max-height:340px;overflow:auto">
      <table class="data">
        <thead><tr><th>条码</th><th>状态</th><th>去向</th><th></th></tr></thead>
        <tbody>${d.copies.map((c) => `<tr>
          <td class="mono small">${escapeHtml(c.barcode)}</td>
          <td>${badge(c.status)}</td>
          <td class="small muted">${c.holder ? `${escapeHtml(c.holder)} · 应还 ${fmtDate(c.dueAt)}` : '—'}</td>
          <td class="ops">
            <select class="select" data-set="${c.id}" style="height:28px;width:auto;font-size:12.5px">
              ${['available', 'repair', 'lost', 'reserved'].map((s) =>
                `<option value="${s}" ${c.status === s ? 'selected' : ''}>${ST[s][0]}</option>`).join('')}
            </select>
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  const m = modal({
    title: '副本管理',
    width: 640,
    content: el,
    footer: `<button class="btn btn-ghost" data-addcopy>增加 1 册</button>
             <button class="btn" data-close>完成</button>`,
  });
  m.el.querySelector('[data-close]').onclick = () => { m.close(); refresh(); };
  m.el.querySelector('[data-addcopy]').onclick = async () => {
    const r = await api(`/api/admin/books/${bookId}/copies`, { method: 'POST', body: { count: 1 } });
    toast(`已增加 1 册，现在共 ${r.stock.total} 册`, 'ok');
    m.close(); refresh(); openCopies(bookId, refresh);
  };
  el.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-set]');
    if (!sel) return;
    try {
      await api('/api/admin/copies/' + sel.dataset.set, { method: 'PATCH', body: { status: sel.value } });
      toast('状态已更新', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ==================== 分类管理 ==================== */
export async function categories(root) {
  root.innerHTML = `
    <div class="view-head">
      <div><h1>分类管理</h1><p class="desc">按中图法分大类，分类号用于排架与检索。</p></div>
      <div class="view-actions"><button class="btn btn-sm" id="add">新增分类</button></div>
    </div>
    <section class="panel"><div id="table"></div></section>`;

  async function load() {
    const rows = await api('/api/admin/categories');
    $('#table').innerHTML = table([
      { title: '分类号', render: (c) => `<span class="mono">${escapeHtml(c.code || '—')}</span>` },
      { title: '分类名', render: (c) => `<b>${escapeHtml(c.name)}</b>` },
      { title: '图书数', render: (c) => `${c.books} 种` },
      { title: '排序', key: 'sort' },
      { title: '操作', cls: 'ops', render: (c) => `
        <button class="btn btn-sm btn-ghost" data-edit="${c.id}">编辑</button>
        <button class="btn btn-sm btn-ghost" data-del="${c.id}">删除</button>` },
    ], rows, { empty: '还没有分类' });
    root._rows = rows;
  }

  $('#add').onclick = () => formModal({
    title: '新增分类', width: 460,
    fields: [
      { name: 'name', label: '分类名', required: true },
      { name: 'code', label: '分类号', placeholder: 'TP' },
      { name: 'sort', label: '排序', type: 'number', value: 99 },
    ],
    onSubmit: async (b) => { await api('/api/admin/categories', { method: 'POST', body: b }); toast('已新增', 'ok'); load(); },
  });

  root.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const c = root._rows.find((x) => x.id === Number(ed.dataset.edit));
      formModal({
        title: '编辑分类', width: 460,
        fields: [
          { name: 'name', label: '分类名', value: c.name, required: true },
          { name: 'code', label: '分类号', value: c.code },
          { name: 'sort', label: '排序', type: 'number', value: c.sort },
        ],
        onSubmit: async (b) => { await api('/api/admin/categories/' + c.id, { method: 'PUT', body: b }); toast('已保存', 'ok'); load(); },
      });
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const c = root._rows.find((x) => x.id === Number(del.dataset.del));
      const ok = await confirmDialog(`删除分类「${c.name}」？分类下还有图书时不能删除。`, { okText: '删除', danger: true });
      if (!ok) return;
      try { await api('/api/admin/categories/' + c.id, { method: 'DELETE' }); toast('已删除', 'ok'); load(); }
      catch (err) { toast(err.message, 'error'); }
    }
  });
  await load();
}

/* ==================== 读者管理 ==================== */
export async function readers(root, { add = false } = {}) {
  const state = { keyword: '', role: '', status: '' };

  root.innerHTML = `
    <div class="view-head">
      <div><h1>读者管理</h1><p class="desc">借书证、冻结/解冻、借阅上限与初始密码都在这里维护。</p></div>
      <div class="view-actions">
        <button class="btn btn-sm btn-ghost" data-export="readers">导出名册</button>
        <button class="btn btn-sm" id="add-user">新增读者</button>
      </div>
    </div>
    <section class="panel">
      <div class="panel-head">
        <div class="panel-toolbar">
          <input class="input" id="kw" placeholder="证号 / 姓名 / 院系 / 电话" style="width:240px">
          <select class="select" id="role" style="width:120px">
            <option value="">全部角色</option><option value="reader">读者</option>
            <option value="librarian">馆员</option><option value="admin">管理员</option></select>
          <select class="select" id="status" style="width:120px">
            <option value="">全部状态</option><option value="active">正常</option><option value="frozen">已冻结</option></select>
        </div>
        <span class="small muted" id="count"></span>
      </div>
      <div id="table"></div>
    </section>`;

  async function load() {
    const qs = new URLSearchParams();
    if (state.keyword) qs.set('keyword', state.keyword);
    if (state.role) qs.set('role', state.role);
    if (state.status) qs.set('status', state.status);
    const rows = await api('/api/admin/users?' + qs);
    $('#count').textContent = `共 ${rows.length} 人`;
    root._rows = rows;
    $('#table').innerHTML = table([
      { title: '姓名', render: (u) => `<span class="title-cell"><b>${escapeHtml(u.name)}</b>
        <small>${escapeHtml(u.cardNo)} · ${roleName(u.role)}</small></span>` },
      { title: '院系 / 班级', render: (u) => `<span class="small">${escapeHtml(u.dept || '—')}</span>` },
      { title: '电话', render: (u) => `<span class="small mono">${escapeHtml(u.phone || '—')}</span>` },
      { title: '在借', render: (u) => `${u.active}${u.overdue ? ` <span class="pill-status st-overdue">逾期 ${u.overdue}</span>` : ''}` },
      { title: '预约', render: (u) => `${u.reservations} 种` },
      { title: '状态', render: (u) => badge(u.status) },
      { title: '操作', cls: 'ops', render: (u) => `
        <button class="btn btn-sm btn-ghost" data-edit="${u.id}">编辑</button>
        ${u.status === 'active'
          ? `<button class="btn btn-sm btn-ghost" data-freeze="${u.id}">冻结</button>`
          : `<button class="btn btn-sm btn-ghost" data-unfreeze="${u.id}">解冻</button>`}` },
    ], rows, { empty: '没有符合条件的读者' });
  }

  $('#kw').addEventListener('input', debounce((e) => { state.keyword = e.target.value.trim(); load(); }));
  $('#role').onchange = (e) => { state.role = e.target.value; load(); };
  $('#status').onchange = (e) => { state.status = e.target.value; load(); };

  const openForm = (u) => formModal({
    title: u ? '编辑读者' : '新增读者', width: 640,
    fields: [
      { name: 'cardNo', label: '借书证号 / 学号', required: !u, value: u?.cardNo, hint: u ? '证号不可修改' : '' },
      { name: 'name', label: '姓名', required: true, value: u?.name },
      { name: 'dept', label: '院系 / 班级', value: u?.dept },
      { name: 'phone', label: '联系电话', value: u?.phone },
      { name: 'role', label: '角色', type: 'select', value: u?.role || 'reader',
        options: [{ value: 'reader', label: '读者' }, { value: 'librarian', label: '馆员' }, { value: 'admin', label: '管理员' }] },
      { name: 'maxBorrow', label: '借阅上限', type: 'number', value: u?.maxBorrow, hint: '留空用全局规则' },
      { name: 'status', label: '状态', type: 'select', value: u?.status || 'active',
        options: [{ value: 'active', label: '正常' }, { value: 'frozen', label: '冻结' }] },
      { name: 'password', label: u ? '重置密码' : '初始密码', type: 'password',
        hint: u ? '留空则不修改，至少 6 位' : '默认 123456，至少 6 位' },
      { name: 'note', label: '备注', type: 'textarea', value: u?.note, full: true },
    ],
    onSubmit: async (b) => {
      if (u) {
        const { cardNo, ...rest } = b;
        await api('/api/admin/users/' + u.id, { method: 'PUT', body: rest });
        toast('已保存', 'ok');
      } else {
        await api('/api/admin/users', { method: 'POST', body: b });
        toast('读者已创建，初始密码已生效', 'ok');
      }
      load();
    },
  });

  $('#add-user').onclick = () => openForm(null);

  root.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { openForm(root._rows.find((x) => x.id === Number(ed.dataset.edit))); return; }
    const fr = e.target.closest('[data-freeze]');
    if (fr) {
      try { await api('/api/admin/users/' + fr.dataset.freeze, { method: 'PUT', body: { status: 'frozen' } });
        toast('已冻结借阅', 'ok'); load(); } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const un = e.target.closest('[data-unfreeze]');
    if (un) {
      try { await api('/api/admin/users/' + un.dataset.unfreeze, { method: 'PUT', body: { status: 'active' } });
        toast('已解冻', 'ok'); load(); } catch (err) { toast(err.message, 'error'); }
    }
  });

  await load();
  if (add) $('#add-user').click();
}

/* ==================== 公告管理 ==================== */
export async function notices(root, { add = false } = {}) {
  root.innerHTML = `
    <div class="view-head">
      <div><h1>公告管理</h1><p class="desc">置顶公告会出现在前台首屏顶部与首页公告区。</p></div>
      <div class="view-actions"><button class="btn btn-sm" id="add">发布公告</button></div>
    </div>
    <section class="panel"><div id="table"></div></section>`;

  async function load() {
    const rows = await api('/api/admin/notices');
    root._rows = rows;
    $('#table').innerHTML = table([
      { title: '标题', render: (n) => `<span class="title-cell"><b>${escapeHtml(n.title)}</b>
        <small>${escapeHtml(n.body.slice(0, 46))}…</small></span>` },
      { title: '置顶', render: (n) => n.pinned ? '<span class="tag tag-clay">置顶</span>' : '—' },
      { title: '作者', render: (n) => `<span class="small">${escapeHtml(n.author || '—')}</span>` },
      { title: '发布时间', render: (n) => `<span class="small">${fmtDate(n.createdAt)}</span>` },
      { title: '操作', cls: 'ops', render: (n) => `
        <button class="btn btn-sm btn-ghost" data-edit="${n.id}">编辑</button>
        <button class="btn btn-sm btn-ghost" data-del="${n.id}">删除</button>` },
    ], rows, { empty: '还没有公告，发布一条试试' });
  }

  const openForm = (n) => formModal({
    title: n ? '编辑公告' : '发布公告', width: 640, submitText: n ? '保存' : '发布',
    fields: [
      { name: 'title', label: '标题', required: true, value: n?.title, full: true },
      { name: 'body', label: '正文', type: 'textarea', required: true, rows: 8, value: n?.body, full: true },
      { name: 'pinned', label: '置顶', type: 'checkbox', value: n?.pinned, hint: '置顶后显示在前台顶部' },
    ],
    onSubmit: async (b) => {
      if (n) await api('/api/admin/notices/' + n.id, { method: 'PUT', body: b });
      else await api('/api/admin/notices', { method: 'POST', body: b });
      toast(n ? '已保存' : '已发布', 'ok');
      load();
    },
  });

  $('#add').onclick = () => openForm(null);

  root.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { openForm(root._rows.find((x) => x.id === Number(ed.dataset.edit))); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      const ok = await confirmDialog('删除这条公告？', { okText: '删除', danger: true });
      if (!ok) return;
      try { await api('/api/admin/notices/' + del.dataset.del, { method: 'DELETE' }); toast('已删除', 'ok'); load(); }
      catch (err) { toast(err.message, 'error'); }
    }
  });

  await load();
  if (add) $('#add').click();
}

/* ==================== 系统设置 ==================== */
export async function settings(root, { isAdmin }) {
  const d = await api('/api/admin/settings');
  const r = d.rules || {};
  root.innerHTML = `
    <div class="view-head">
      <div><h1>系统设置</h1><p class="desc">站点信息与借阅规则；规则改动会立即对前台生效。</p></div>
    </div>
    <div class="dash-grid">
      <form class="panel" id="settings-form">
        <div class="panel-head"><h2>站点信息</h2></div>
        <div class="panel-body form-grid">
          <div class="field"><label>站点名称</label><input class="input" name="siteName" value="${escapeHtml(d.siteName)}"></div>
          <div class="field"><label>副标题</label><input class="input" name="siteSub" value="${escapeHtml(d.siteSub)}"></div>
          <div class="field full"><label>顶部公告条</label>
            <input class="input" name="noticeBar" value="${escapeHtml(d.noticeBar)}">
            <span class="small muted">留空则不显示公告条</span></div>
        </div>
        <div class="panel-head"><h2>借阅规则</h2></div>
        <div class="panel-body form-grid">
          <div class="field"><label>借期（天）</label><input class="input" type="number" name="borrowDays" value="${r.borrowDays}"></div>
          <div class="field"><label>同时在借上限（册）</label><input class="input" type="number" name="maxBorrow" value="${r.maxBorrow}"></div>
          <div class="field"><label>续借次数</label><input class="input" type="number" name="renewTimes" value="${r.renewTimes}"></div>
          <div class="field"><label>每次续借延长（天）</label><input class="input" type="number" name="renewDays" value="${r.renewDays}"></div>
          <div class="field"><label>同时预约上限（种）</label><input class="input" type="number" name="maxReserve" value="${r.maxReserve}"></div>
          <div class="field"><label>到书保留（天）</label><input class="input" type="number" name="reserveHoldDays" value="${r.reserveHoldDays}"></div>
          <div class="field"><label>逾期费（元/天）</label><input class="input" type="number" step="0.01" name="finePerDay" value="${r.finePerDay}"></div>
          <div class="field"><label>开馆时间</label><input class="input" name="openHours" value="${escapeHtml(r.openHours || '')}"></div>
        </div>
        <div class="panel-body" style="padding-top:0">
          <button class="btn" type="submit" ${isAdmin ? '' : 'disabled'}>保存设置</button>
          ${isAdmin ? '' : '<span class="small muted" style="margin-left:10px">只有管理员可以修改设置</span>'}
        </div>
      </form>

      <div class="dash-col">
        <section class="panel">
          <div class="panel-head"><h2>数据概况</h2></div>
          <div class="panel-body" style="padding-top:6px">
            <ul class="mini-list">
              <li><span>图书</span><span>${d.counts.books} 种</span></li>
              <li><span>副本</span><span>${d.counts.copies} 册</span></li>
              <li><span>借阅记录</span><span>${d.counts.borrows} 条</span></li>
              <li><span>预约记录</span><span>${d.counts.reservations} 条</span></li>
              <li><span>用户</span><span>${d.counts.users} 人</span></li>
              <li><span>操作日志</span><span>${d.counts.logs} 条</span></li>
            </ul>
            <p class="small muted" style="margin:12px 0 0;word-break:break-all">数据库：${escapeHtml(d.dbFile)}</p>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>导出</h2></div>
          <div class="panel-body" style="display:flex;flex-direction:column;gap:8px">
            <button class="btn btn-ghost btn-block" data-export="books">图书台账 CSV</button>
            <button class="btn btn-ghost btn-block" data-export="readers">读者名册 CSV</button>
            <button class="btn btn-ghost btn-block" data-export="borrows">借阅流水 CSV</button>
          </div>
        </section>
      </div>
    </div>`;

  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      siteName: fd.get('siteName'), siteSub: fd.get('siteSub'), noticeBar: fd.get('noticeBar'),
      rules: {
        borrowDays: Number(fd.get('borrowDays')), maxBorrow: Number(fd.get('maxBorrow')),
        renewTimes: Number(fd.get('renewTimes')), renewDays: Number(fd.get('renewDays')),
        maxReserve: Number(fd.get('maxReserve')), reserveHoldDays: Number(fd.get('reserveHoldDays')),
        finePerDay: Number(fd.get('finePerDay')), openHours: fd.get('openHours'),
      },
    };
    try {
      await api('/api/admin/settings', { method: 'PUT', body });
      toast('设置已保存', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ==================== 操作日志 ==================== */
export async function logs(root) {
  let page = 1;
  root.innerHTML = `
    <div class="view-head">
      <div><h1>操作日志</h1><p class="desc">借还、预约、书目与读者变更都会留痕，便于答辩时说明"谁在什么时候做了什么"。</p></div>
    </div>
    <section class="panel"><div id="table"></div><div id="pager-host" style="padding:0 18px"></div></section>`;

  async function load() {
    const d = await api('/api/admin/logs?page=' + page);
    $('#table').innerHTML = table([
      { title: '时间', render: (l) => `<span class="small mono">${fmtDateTime(l.at)}</span>` },
      { title: '操作人', render: (l) => `<span class="small">${escapeHtml(l.actor || 'system')}</span>` },
      { title: '动作', render: (l) => `<span class="tag">${escapeHtml(l.action)}</span>` },
      { title: '详情', render: (l) => `<span class="small">${escapeHtml(l.detail || '')}</span>` },
    ], d.items, { empty: '还没有日志' });
    $('#pager-host').innerHTML = '';
    $('#pager-host').appendChild(pager(d, (p) => { page = p; load(); }));
  }
  await load();
}
