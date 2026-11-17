import {
  $, $$, api, mountHeader, mountFooter, coverHtml, escapeHtml, fmtDate, fmtRel, toast, emptyHtml, bookCard,
} from './common.js';

const me = await mountHeader();
mountFooter();

const id = new URLSearchParams(location.search).get('id');
let data;
try {
  data = await api('/api/books/' + id);
} catch (err) {
  $('#detail').innerHTML = emptyHtml('没有这本书', err.message);
  throw err;
}
const { book, copies, related, rules, borrowTimes, lastBorrowed } = data;
document.title = `${book.title} · ${document.title.split(' · ').pop()}`;
$('#crumb-title').textContent = book.title;

const statusText = { available: '在架', borrowed: '借出', reserved: '已预约预留', lost: '遗失', repair: '修补中' };
const statusClass = { available: 'available', borrowed: 'borrowed', reserved: 'reserved', lost: 'lost', repair: 'repair' };

const myBorrow = book.myBorrow;
const myRes = book.myReservation;

$('#detail').innerHTML = `
  <div class="detail-side">
    <div class="detail-cover">${coverHtml(book, { badge: false })}</div>
    <div class="cover-meta">
      <div><span>馆藏册数</span><b>${book.total} 册</b></div>
      <div><span>在架</span><b>${book.available} 册</b></div>
      <div><span>累计借出</span><b>${borrowTimes} 次</b></div>
      <div><span>最近借出</span><b>${lastBorrowed ? fmtRel(lastBorrowed) : '—'}</b></div>
    </div>
  </div>

  <div class="detail-main">
    <h1>${escapeHtml(book.title)}</h1>
    <p class="byline">${escapeHtml(book.author || '佚名')}${book.publisher ? ` <span>·</span> ${escapeHtml(book.publisher)}` : ''}${book.pubYear ? ` <span>·</span> ${book.pubYear}` : ''}</p>
    <div class="pills">
      ${book.category ? `<a class="tag tag-green" href="search.html?category=${book.categoryId}">${escapeHtml(book.category)}</a>` : ''}
      ${(book.tags || '').split(',').filter(Boolean).slice(0, 4).map((t) => `<span class="tag">${escapeHtml(t.trim())}</span>`).join('')}
      ${book.isbn ? `<span class="tag tag-blue mono">ISBN ${escapeHtml(book.isbn)}</span>` : ''}
    </div>

    <div class="stock-panel">
      <div class="stock-line">
        <span class="big ${book.available > 0 ? 'ok' : 'no'}">
          ${book.available > 0 ? `在架 ${book.available} 册，可借` : (book.waiting ? `已借完 · ${book.waiting} 人排队` : '已借完')}
        </span>
        <span class="stock-bars" aria-hidden="true">
          ${copies.slice(0, 12).map((c) => `<i class="${c.status === 'available' ? 'on' : c.status === 'borrowed' ? 'busy' : ''}"></i>`).join('')}
        </span>
        <span class="small muted">共 ${book.total} 册</span>
      </div>

      <div class="actions" id="actions"></div>
      <div id="action-hint"></div>
    </div>

    ${book.summary ? `<div class="description"><h2>内容简介</h2><p>${escapeHtml(book.summary)}</p></div>` : ''}

    <dl class="meta-table">
      <div><dt>馆藏位置</dt><dd>${escapeHtml(book.location || '—')}</dd></div>
      <div><dt>出版社</dt><dd>${escapeHtml(book.publisher || '—')}</dd></div>
      <div><dt>出版年</dt><dd>${book.pubYear || '—'}</dd></div>
      <div><dt>定价</dt><dd>${book.price ? '￥' + book.price : '—'}</dd></div>
      <div><dt>ISBN</dt><dd class="mono">${escapeHtml(book.isbn || '—')}</dd></div>
      <div><dt>分类号</dt><dd>${escapeHtml(book.category || '—')}</dd></div>
    </dl>
  </div>

  <div class="copies" style="grid-column:1/-1">
    <h2>馆藏副本 <small>每一册都有独立条码，状态实时更新</small></h2>
    <div class="copy-chips">
      ${copies.map((c) => `
        <span class="copy-chip ${statusClass[c.status] || ''}">
          ${escapeHtml(c.barcode)}
          <span class="st">${statusText[c.status] || c.status}</span>
        </span>`).join('') || '<span class="muted small">暂无副本</span>'}
    </div>
  </div>
`;

/* ---------- 操作按钮 ---------- */
const actions = $('#actions');
const hint = $('#action-hint');

function btn(label, cls, id, disabled = false, title = '') {
  return `<button class="btn btn-lg ${cls}" id="${id}" ${disabled ? 'disabled' : ''} ${title ? `title="${escapeHtml(title)}"` : ''}>${label}</button>`;
}

if (myBorrow) {
  actions.innerHTML = btn('已借这本书', 'btn-ghost', 'owned', true);
  hint.innerHTML = `<div class="hint">应还日期 <b>${fmtDate(myBorrow.dueAt)}</b>，可到「我的书房」续借。</div>`;
} else if (myRes && myRes.status === 'ready') {
  actions.innerHTML = btn('到馆取书（已为我预留）', '', 'pickup');
  hint.innerHTML = `<div class="hint">系统已为你锁定一册，请在 <b>${fmtDate(myRes.expireAt)}</b> 前到流通台办理借出，逾期自动释放。</div>`;
} else if (myRes && myRes.status === 'waiting') {
  actions.innerHTML = btn(`已预约 · 排队第 ${myRes.queueNo} 位`, 'btn-ghost', 'queued', true);
  hint.innerHTML = `<div class="hint">有副本归还时会自动通知你（本馆以站内状态为准），请留意「我的书房」。</div>`;
} else if (book.available > 0) {
  actions.innerHTML = btn(`立即借阅`, '', 'borrow') + btn('加入预约', 'btn-ghost', 'reserve');
  hint.innerHTML = `<div class="hint">借期 <b>${rules.borrowDays}</b> 天，到期前可续借 ${rules.renewTimes} 次；单人在借上限 ${rules.maxBorrow} 册。</div>`;
} else {
  actions.innerHTML = btn('预约这本书', 'btn-clay', 'reserve');
  hint.innerHTML = `<div class="hint">当前 ${book.borrowed} 册全部借出${book.waiting ? `，已有 ${book.waiting} 人排队` : ''}。预约后有人归还即按顺序为你保留 ${rules.reserveHoldDays} 天。</div>`;
}

if (!me) {
  actions.innerHTML = `<a class="btn btn-lg" href="login.html?next=${encodeURIComponent('book.html?id=' + book.id)}">登录后借阅 / 预约</a>`;
  hint.innerHTML = `<div class="hint">读者用借书证号登录；馆员账号可在后台办理借还。</div>`;
}

const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };

on('#borrow', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('/api/borrow', { method: 'POST', body: { bookId: book.id } });
    toast(`借出成功，应还 ${fmtDate(r.dueAt)}`, 'ok');
    setTimeout(() => location.reload(), 700);
  } catch (err) {
    toast(err.message, 'error');
    e.target.disabled = false;
  }
});

on('#reserve', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('/api/reserve', { method: 'POST', body: { bookId: book.id } });
    toast(r.ready ? '已为你锁定一册，请在 3 天内到馆取书' : `预约成功，当前排第 ${r.queueNo} 位`, 'ok');
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    toast(err.message, 'error');
    e.target.disabled = false;
  }
});

on('#pickup', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('/api/borrow', { method: 'POST', body: { bookId: book.id } });
    toast(`取书成功，应还 ${fmtDate(r.dueAt)}`, 'ok');
    setTimeout(() => location.reload(), 700);
  } catch (err) {
    toast(err.message, 'error');
    e.target.disabled = false;
  }
});

/* ---------- 同类推荐 ---------- */
$('#related').innerHTML = related.length
  ? related.map(bookCard).join('')
  : emptyHtml('这个分类下暂时没有别的书');
