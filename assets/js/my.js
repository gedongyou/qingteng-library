import {
  $, $$, api, mountHeader, mountFooter, escapeHtml, fmtDate, fmtRel, toast,
  emptyHtml, confirmDialog, daysLeft, coverHtml, requireLogin, loadSite, site,
} from './common.js';

const me = await mountHeader();
mountFooter();
if (!requireLogin(me, 'my.html')) throw new Error('need login');

$('#greeting').textContent = `${me.name}，你好`;

let data = await api('/api/my');
const { user, stats, rules, borrows, reservations } = data;

/* ---------- 我的数据 ---------- */
const borrowing = borrows.filter((b) => b.status === 'borrowed');
const returned = borrows.filter((b) => b.status === 'returned');
const activeRes = reservations.filter((r) => ['waiting', 'ready'].includes(r.status));

$('#my-sub').textContent = `${user.dept || '读者'} · 借书证号 ${user.cardNo}　` +
  `借期 ${rules.borrowDays} 天，可续借 ${rules.renewTimes} 次`;

$('#my-stats').innerHTML = `
  <div class="stat"><b>${borrowing.length}</b><span>在借</span></div>
  <div class="stat ${stats.overdue ? 'warn' : ''}"><b>${stats.overdue}</b><span>逾期</span></div>
  <div class="stat"><b>${activeRes.length}</b><span>预约中</span></div>
  <div class="stat"><b>${returned.length}</b><span>累计借阅</span></div>`;

$('#c-borrow').textContent = borrowing.length ? `(${borrowing.length})` : '';
$('#c-res').textContent = activeRes.length ? `(${activeRes.length})` : '';
$('#c-hist').textContent = returned.length ? `(${returned.length})` : '';

/* ---------- 借阅中 ---------- */
function miniCover(b) {
  return `<div class="mini-cover">${coverHtml({ ...b, available: 1, total: 1 }, { badge: false })}</div>`;
}

$('#panel-borrowing').innerHTML = borrowing.length ? `<div class="loan-list">${borrowing.map((b) => {
  const left = daysLeft(b.dueAt);
  const over = left < 0;
  const soon = left >= 0 && left <= 3;
  return `
  <article class="loan ${over ? 'overdue' : ''}">
    ${miniCover(b)}
    <div>
      <h3><a href="book.html?id=${b.id}">${escapeHtml(b.title)}</a></h3>
      <div class="by">${escapeHtml(b.author || '佚名')} · 条码 <span class="mono">${escapeHtml(b.barcode)}</span></div>
      <div class="dates">
        <span>借出 ${fmtDate(b.borrowedAt)}</span>
        <span>应还 <b class="${over ? 'due-over' : soon ? 'due-soon' : ''}">${fmtDate(b.dueAt)}</b>
          ${over ? `（逾期 ${b.overdueDays} 天，应缴 ￥${b.fine}）` : soon ? `（还剩 ${left} 天）` : ''}</span>
        <span>已续借 ${b.renewCount}/${b.maxRenew} 次</span>
      </div>
    </div>
    <div class="ops">
      ${b.canRenew ? `<button class="btn btn-sm btn-ghost" data-renew="${b.id}">续借</button>` : ''}
      <button class="btn btn-sm" data-return="${b.id}">归还登记</button>
    </div>
  </article>`;
}).join('')}</div>` : emptyHtml('现在没有在借的图书', '去检索页找一本吧');

/* ---------- 预约 ---------- */
$('#panel-reservations').innerHTML = reservations.length ? `<div class="loan-list">${reservations.map((r) => {
  const st = { waiting: ['排队中', 'tag'], ready: ['已到书', 'tag tag-gold'], fulfilled: ['已借出', 'tag tag-green'], cancelled: ['已取消', 'tag'], expired: ['已过期', 'tag tag-danger'] }[r.status] || ['—', 'tag'];
  return `
  <article class="res-item ${r.status === 'ready' ? 'ready' : ''}">
    <div>
      <h3><a href="book.html?id=${r.bookId}">${escapeHtml(r.title)}</a></h3>
      <div class="res-meta">
        <span class="${st[1]}">${st[0]}</span>
        ${r.status === 'waiting' && r.position ? `<span>排第 ${r.position} 位</span>` : ''}
        ${r.status === 'ready' && r.expireAt ? `<span>请在 <b style="color:var(--clay)">${fmtDate(r.expireAt)}</b> 前到馆取书</span>` : ''}
        ${r.status === 'fulfilled' ? `<span>已于 ${fmtDate(r.readyAt)} 借出</span>` : ''}
        <span>预约于 ${fmtRel(r.createdAt)}</span>
      </div>
    </div>
    <div class="res-ops">
      ${r.status === 'ready' ? `<a class="btn btn-sm" href="book.html?id=${r.bookId}">去取书</a>` : ''}
      ${['waiting', 'ready'].includes(r.status) ? `<button class="btn btn-sm btn-ghost" data-cancel="${r.id}">取消预约</button>` : ''}
    </div>
  </article>`;
}).join('')}</div>` : emptyHtml('没有预约记录', '书被借完时可以在详情页预约');

/* ---------- 历史 ---------- */
$('#panel-history').innerHTML = returned.length ? `
  <div class="table-wrap card">
    <table class="data">
      <thead><tr><th>书名</th><th>条码</th><th>借出</th><th>归还</th><th>续借</th></tr></thead>
      <tbody>${returned.map((b) => `
        <tr>
          <td><a href="book.html?id=${b.id}">${escapeHtml(b.title)}</a></td>
          <td class="mono small muted">${escapeHtml(b.barcode)}</td>
          <td class="small">${fmtDate(b.borrowedAt)}</td>
          <td class="small">${fmtDate(b.returnedAt)}</td>
          <td class="small">${b.renewCount} 次</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : emptyHtml('还没有归还记录');

/* ---------- 账号 ---------- */
$('#panel-account').innerHTML = `
  <div class="acct-card">
    <div class="card">
      <h3 style="font-size:17px;margin-bottom:14px">账号信息</h3>
      <div class="kv"><span>姓名</span><b>${escapeHtml(user.name)}</b></div>
      <div class="kv"><span>借书证号</span><b class="mono">${escapeHtml(user.cardNo)}</b></div>
      <div class="kv"><span>院系 / 班级</span><b>${escapeHtml(user.dept || '—')}</b></div>
      <div class="kv"><span>联系电话</span><b>${escapeHtml(user.phone || '—')}</b></div>
      <div class="kv"><span>借阅上限</span><b>${user.maxBorrow || rules.maxBorrow} 册</b></div>
      <div class="kv"><span>账号状态</span><b>${user.status === 'active' ? '正常' : '已冻结'}</b></div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3 style="font-size:17px;margin-bottom:14px">修改密码</h3>
      <form id="pwd-form" class="form-row">
        <div class="field"><label for="old">原密码</label>
          <input class="input" id="old" type="password" required autocomplete="current-password"></div>
        <div class="field"><label for="new1">新密码（至少 6 位）</label>
          <input class="input" id="new1" type="password" required minlength="6" autocomplete="new-password"></div>
        <div class="field"><label for="new2">确认新密码</label>
          <input class="input" id="new2" type="password" required minlength="6" autocomplete="new-password"></div>
        <div><button class="btn" type="submit">保存新密码</button></div>
      </form>
    </div>
  </div>`;

/* ---------- 交互 ---------- */
document.addEventListener('click', async (e) => {
  const renew = e.target.closest('[data-renew]');
  if (renew) {
    renew.disabled = true;
    try {
      const r = await api('/api/renew', { method: 'POST', body: { borrowId: Number(renew.dataset.renew) } });
      toast(`续借成功，应还 ${fmtDate(r.dueAt)}`, 'ok');
      setTimeout(() => location.reload(), 700);
    } catch (err) { toast(err.message, 'error'); renew.disabled = false; }
    return;
  }
  const ret = e.target.closest('[data-return]');
  if (ret) {
    const ok = await confirmDialog('确认已把这本书还到流通台？归还登记后副本立即恢复「在架」。', { okText: '确认归还' });
    if (!ok) return;
    ret.disabled = true;
    try {
      const r = await api('/api/return', { method: 'POST', body: { borrowId: Number(ret.dataset.return) } });
      toast(r.overdueDays ? `已归还，逾期 ${r.overdueDays} 天，应缴 ￥${r.fine}` : '已归还，感谢按时还书', 'ok');
      setTimeout(() => location.reload(), 800);
    } catch (err) { toast(err.message, 'error'); ret.disabled = false; }
    return;
  }
  const cancel = e.target.closest('[data-cancel]');
  if (cancel) {
    const ok = await confirmDialog('取消这次预约？如果已为你预留副本，书会顺延给下一位排队的人。', { okText: '取消预约', danger: true });
    if (!ok) return;
    cancel.disabled = true;
    try {
      await api('/api/reserve/cancel', { method: 'POST', body: { id: Number(cancel.dataset.cancel) } });
      toast('预约已取消', 'ok');
      setTimeout(() => location.reload(), 600);
    } catch (err) { toast(err.message, 'error'); cancel.disabled = false; }
  }
});

$('#pwd-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const oldP = $('#old').value, n1 = $('#new1').value, n2 = $('#new2').value;
  if (n1 !== n2) { toast('两次输入的新密码不一致', 'error'); return; }
  try {
    await api('/api/password', { method: 'POST', body: { oldPassword: oldP, newPassword: n1 } });
    toast('密码已修改，下次登录请用新密码', 'ok');
    e.target.reset();
  } catch (err) { toast(err.message, 'error'); }
});

/* ---------- 标签切换 ---------- */
const tabs = $$('.tabs [role="tab"]');
tabs.forEach((t) => t.addEventListener('click', () => {
  tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
  ['borrowing', 'reservations', 'history', 'account'].forEach((k) => {
    $('#panel-' + k).hidden = k !== t.dataset.tab;
  });
  history.replaceState(null, '', t.dataset.tab === 'borrowing' ? location.pathname + location.search : `#${t.dataset.tab}`);
}));
if (location.hash) {
  const t = tabs.find((x) => '#' + x.dataset.tab === location.hash);
  if (t) t.click();
}
