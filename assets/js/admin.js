import { $, api, mountFooter, escapeHtml, roleName } from './common.js';
import { paintIcons } from './icons.js';
import { exportCsv } from './admin-ui.js';
import * as Views from './admin-views.js';

paintIcons();

const TITLES = {
  dashboard: '仪表盘', circulation: '借还办理', borrows: '借阅记录',
  reservations: '预约管理', books: '图书管理', categories: '分类管理',
  readers: '读者管理', notices: '公告管理', settings: '系统设置', logs: '操作日志',
};

/* ---------- 权限校验 ---------- */
let me = null;
try { me = (await api('/api/me')).user; } catch { /* 未登录 */ }

if (!me || me.role === 'reader') {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="admin-gate">
      <div class="card">
        <h2>${me ? '需要馆员权限' : '请先登录'}</h2>
        <p>${me ? '当前账号是读者，无法进入管理后台。可以用演示馆员账号 lib001 / lib123 查看。' : '管理后台只对馆员与管理员开放。'}</p>
        <a class="btn" href="login.html?next=${encodeURIComponent('admin.html')}">去登录</a>
        <a class="btn btn-ghost" href="index.html" style="margin-left:8px">返回前台</a>
      </div>
    </div>`);
  throw new Error('no permission');
}

/* ---------- 头部账号 ---------- */
$('#admin-me').innerHTML = `<b>${escapeHtml(me.name)}</b>${escapeHtml(me.cardNo)} · ${roleName(me.role)}`;
$('#admin-acct').innerHTML = `
  <button class="acct-btn"><span class="avatar">${escapeHtml(me.name.slice(-1))}</span>
    <span class="small">${escapeHtml(me.name)}</span></button>
  <div class="acct-menu">
    <div class="who"><b>${escapeHtml(me.name)}</b><span>${roleName(me.role)} · ${escapeHtml(me.cardNo)}</span></div>
    <a href="index.html">前台首页</a><a href="my.html">我的书房</a>
    <button data-logout>退出登录</button>
  </div>`;
const acctBtn = $('#admin-acct .acct-btn');
const acctMenu = $('#admin-acct .acct-menu');
acctBtn.onclick = (e) => { e.stopPropagation(); acctMenu.classList.toggle('open'); };
document.addEventListener('click', () => acctMenu.classList.remove('open'));
$('#admin-acct [data-logout]').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  location.href = 'login.html';
};

$('#today').textContent = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
});

/* ---------- 路由 ---------- */
const view = $('#view');
let current = '';

async function route() {
  const hash = location.hash.replace('#', '') || 'dashboard';
  const [name, qs] = hash.split('?');
  const opts = Object.fromEntries(new URLSearchParams(qs || ''));
  const handler = Views[name];
  if (!handler) { location.hash = '#dashboard'; return; }

  current = name;
  document.querySelectorAll('#admin-nav a').forEach((a) => {
    a.classList.toggle('on', a.dataset.view === name);
  });
  $('#admin-crumb').textContent = TITLES[name] || name;
  document.querySelector('.admin-side')?.classList.remove('open');

  try {
    await handler(view, { isAdmin: me.role === 'admin', add: opts.add === '1' });
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      view.innerHTML = `<div class="empty">${escapeHtml(err.message)}<br>
        <a class="btn btn-sm" style="margin-top:12px" href="login.html?next=admin.html">重新登录</a></div>`;
    } else {
      view.innerHTML = `<div class="empty">加载失败：${escapeHtml(err.message)}</div>`;
    }
  }
}

window.addEventListener('hashchange', route);

/* ---------- 全局事件 ---------- */
document.addEventListener('click', async (e) => {
  const go = e.target.closest('[data-go]');
  if (go) {
    const target = go.dataset.go + (go.dataset.add ? '?add=1' : '');
    if (TITLES[go.dataset.go]) location.hash = '#' + target;
    return;
  }
  const ex = e.target.closest('[data-export]');
  if (ex) { exportCsv(ex.dataset.export); }
});

$('#refresh').onclick = () => route();

/* 移动端抽屉 */
if (window.matchMedia('(max-width: 860px)').matches) {
  const top = $('.admin-top');
  top.insertAdjacentHTML('afterbegin',
    `<button class="btn btn-sm btn-ghost" id="drawer">菜单</button>`);
  $('#drawer').onclick = () => document.querySelector('.admin-side').classList.toggle('open');
}

mountFooter();
route();
