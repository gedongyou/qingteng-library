/* 前端公共逻辑：API 封装、页头渲染、书卡、提示、弹层、封面生成 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------------- API ----------------
   纯静态版：不访问网络，直接把 /api/* 的请求交给浏览器内的本地接口层（api-local.js） */
import { dispatch } from './api-local.js';

export async function api(path, { method = 'GET', body } = {}) {
  return dispatch(path, { method, body });
}

/** 页面链接：静态站点没有服务端路由，统一改成 xxx.html 形式 */
export const href = {
  home: 'index.html',
  search: (qs = '') => 'search.html' + (qs ? '?' + qs : ''),
  book: (id) => `book.html?id=${id}`,
  my: 'my.html',
  login: (next = '') => 'login.html' + (next ? '?next=' + encodeURIComponent(next) : ''),
  admin: 'admin.html',
  notices: 'notices.html',
};

/** 当前页面的名称，用于导航高亮 */
export function pageName() {
  const f = location.pathname.split('/').pop() || 'index.html';
  return f.replace(/\.html$/, '') || 'index';
}

/* ---------------- 提示 ---------------- */
let toastHost;
export function toast(msg, type = '') {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  toastHost.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

/* ---------------- 弹层 ---------------- */
export function modal({ title, content, footer, width = 560, onClose }) {
  const host = document.createElement('div');
  host.className = 'modal-host';
  host.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="width:min(${width}px,100%)">
      <header>
        <h3></h3>
        <button class="modal-close" aria-label="关闭">&times;</button>
      </header>
      <div class="content"></div>
      ${footer ? '<footer></footer>' : ''}
    </div>`;
  $('h3', host).textContent = title;
  const contentEl = $('.content', host);
  if (typeof content === 'string') contentEl.innerHTML = content;
  else if (content) contentEl.appendChild(content);
  if (footer) {
    const f = $('footer', host);
    if (typeof footer === 'string') f.innerHTML = footer;
    else f.appendChild(footer);
  }
  const close = () => {
    host.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  host.addEventListener('click', (e) => { if (e.target === host) close(); });
  $('.modal-close', host).addEventListener('click', close);
  document.body.appendChild(host);
  return { el: host, close, content: contentEl, footer: footer ? $('footer', host) : null };
}

export function confirmDialog(text, { okText = '确定', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal({
      title: '请确认',
      width: 420,
      content: `<p style="margin:0;color:var(--ink-2);line-height:1.7">${escapeHtml(text)}</p>`,
      footer: `<button class="btn btn-ghost" data-no>取消</button>
               <button class="btn ${danger ? 'btn-clay' : ''}" data-yes>${escapeHtml(okText)}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    $('[data-no]', m.el).onclick = () => m.close();
    $('[data-yes]', m.el).onclick = () => { answered = true; resolve(true); m.close(); };
  });
}

/* ---------------- 转义与格式化 ---------------- */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—');
export const fmtDateTime = (s) => (s ? new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export function fmtRel(s) {
  if (!s) return '—';
  const diff = Date.now() - new Date(s).getTime();
  const d = Math.floor(diff / 864e5);
  if (d <= 0) return '今天';
  if (d === 1) return '昨天';
  if (d < 30) return `${d} 天前`;
  if (d < 365) return `${Math.floor(d / 30)} 个月前`;
  return `${Math.floor(d / 365)} 年前`;
}
export function daysLeft(dueAt) {
  return Math.ceil((new Date(dueAt).getTime() - Date.now()) / 864e5);
}

/* ---------------- 封面 ---------------- */
/* 浅色封面配色：[底色渐变起, 渐变止, 书脊色] */
const PALETTES = [
  ['#eef4f0', '#dbe9e2', '#1f5d4c'], ['#fbeeea', '#f5ddd4', '#b5562f'],
  ['#eef1f8', '#dde3f0', '#3c4b6b'], ['#faf4e4', '#f0e6cb', '#a8813a'],
  ['#f4eefa', '#e7dcf3', '#5b4477'], ['#eaf3f7', '#d8e9f1', '#2f5a6b'],
  ['#fbf0e4', '#f3e0c9', '#8a5a2b'], ['#eef5ec', '#dcead8', '#3f6b3a'],
];
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
export function coverHtml(book, { badge = true } = {}) {
  const st = book.status;
  const badgeHtml = !badge ? '' : st === 'none'
    ? '<span class="cover-badge none">暂无馆藏</span>'
    : book.available === 0
      ? '<span class="cover-badge none">已借完</span>'
      : book.available <= 1
        ? `<span class="cover-badge low">仅剩 ${book.available} 册</span>`
        : `<span class="cover-badge">在架 ${book.available}</span>`;
  if (book.cover) {
    return `${badgeHtml}<img src="${escapeHtml(book.cover)}" alt="${escapeHtml(book.title)} 封面" loading="lazy">`;
  }
  const [c1, c2, c3] = PALETTES[hashStr(book.title) % PALETTES.length];
  const cat = book.category || '馆藏';
  return `${badgeHtml}
    <div class="cover-alt" style="--c1:${c1};--c2:${c2};--c3:${c3}">
      <div class="cm">${escapeHtml(cat)}</div>
      <div class="ct">${escapeHtml(book.title)}</div>
      <div class="ca">${escapeHtml(book.author || '佚名')}</div>
    </div>`;
}

export function bookCard(book) {
  return `
  <article class="book-card">
    <a class="cover" href="book.html?id=${book.id}" aria-label="${escapeHtml(book.title)}">${coverHtml(book)}</a>
    <div class="body">
      <h3><a href="book.html?id=${book.id}">${escapeHtml(book.title)}</a></h3>
      <div class="meta">${escapeHtml(book.author || '佚名')}${book.publisher ? ' · ' + escapeHtml(book.publisher) : ''}</div>
      <div class="foot">
        <span class="small muted">馆藏 ${book.total} 册</span>
        ${book.available > 0
          ? `<span class="tag tag-green"><i class="dot"></i>可借 ${book.available}</span>`
          : `<span class="tag tag-clay">可预约${book.waiting ? ' · ' + book.waiting + ' 人排队' : ''}</span>`}
      </div>
    </div>
  </article>`;
}

/* ---------------- 页头 ---------------- */
export let site = { siteName: '青藤图书室', siteSub: '校园图书借阅预约系统', noticeBar: '', rules: {} };

export async function loadSite() {
  try {
    site = await api('/api/site');
    document.title = document.title.replaceAll('%SITE%', site.siteName);
  } catch { /* 忽略 */ }
  return site;
}

export async function mountHeader({ active = '' } = {}) {
  const host = document.getElementById('site-header');
  if (!host) return null;

  await loadSite();
  let me = null;
  try { me = (await api('/api/me')).user; } catch { /* 未登录 */ }

  const cur = pageName();
  const navItems = [
    ['index', 'index.html', '首页'],
    ['search', 'search.html', '馆藏检索'],
    ['notices', 'notices.html', '公告'],
    ['board', 'board.html', '数字看板'],
    ...(me ? [['my', 'my.html', '我的书房']] : [['login', 'login.html', '登录']]),
    ...(me && me.role !== 'reader' ? [['admin', 'admin.html', '管理后台']] : []),
  ];

  const right = me
    ? `<div class="acct">
         <button class="acct-btn" aria-haspopup="menu" aria-expanded="false">
           <span class="avatar">${escapeHtml(me.name.slice(-1))}</span>
           <span class="small">${escapeHtml(me.name)}</span>
         </button>
         <div class="acct-menu" role="menu">
           <div class="who"><b>${escapeHtml(me.name)}</b><span>${escapeHtml(me.cardNo)} · ${roleName(me.role)}</span></div>
           <a href="my.html" role="menuitem">我的书房</a>
           ${me.role !== 'reader' ? '<a href="admin.html" role="menuitem">管理后台</a>' : ''}
           <button data-logout role="menuitem">退出登录</button>
         </div>
       </div>`
    : `<a class="btn btn-ghost btn-sm" href="login.html">登录</a>
       <a class="btn btn-sm" href="search.html">查书</a>`;

  host.innerHTML = `
    <div class="notice-bar" ${site.noticeBar ? '' : 'hidden'}>
      <div class="wrap"><span class="label">公告</span><p>${escapeHtml(site.noticeBar)}</p></div>
    </div>
    <header class="site-header">
      <div class="wrap">
        <button class="nav-toggle" type="button" aria-label="展开导航" aria-expanded="false">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>
        <a class="brand" href="index.html">
          <span class="brand-mark">青</span>
          <span class="brand-text">
            <span class="brand-name">${escapeHtml(site.siteName)}</span>
            <span class="brand-sub">${escapeHtml(site.siteSub)}</span>
          </span>
        </a>
        <nav class="nav" aria-label="主导航">
          ${navItems.map(([key, link, label]) =>
            `<a href="${link}" ${key === cur ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
        </nav>
        <div class="header-right">${right}</div>
      </div>
    </header>`;

  const navToggle = $('.nav-toggle', host);
  const navEl = $('.nav', host);
  if (navToggle && navEl) {
    navToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = navEl.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!navEl.contains(e.target) && e.target !== navToggle) {
        navEl.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  const acctBtn = $('.acct-btn', host);
  if (acctBtn) {
    const menu = $('.acct-menu', host);
    acctBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('open');
      acctBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => menu.classList.remove('open'));
    const out = $('[data-logout]', host);
    if (out) out.addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' });
      location.href = 'index.html';
    });
  }
  return me;
}

export function roleName(role) {
  return { reader: '读者', librarian: '馆员', admin: '管理员' }[role] || role;
}

/* ---------------- 页脚 ---------------- */
export function mountFooter() {
  const host = document.getElementById('site-footer');
  if (!host) return;
  const name = escapeHtml(site.siteName);
  const sub = escapeHtml(site.siteSub);
  host.innerHTML = `
    <footer class="site-footer">
      <div class="wrap">
        <div class="footer-cols">
          <div>
            <div class="brand" style="margin-bottom:12px">
              <span class="brand-mark">青</span>
              <span class="brand-text">
                <span class="brand-name">${name}</span>
                <span class="brand-sub">${sub}</span>
              </span>
            </div>
            <p class="small">面向师生的小型图书室管理系统：在线查书、预约借书、归还登记、库存盘点，一套流程走完。</p>
          </div>
          <div>
            <h4>服务</h4>
            <a href="search.html">馆藏检索</a>
            <a href="search.html?status=available">在架可借</a>
            <a href="notices.html">通知公告</a>
            <a href="my.html">我的书房</a>
            <a href="board.html">数字看板</a>
          </div>
          <div>
            <h4>使用帮助</h4>
            <a href="notices.html">借阅规则</a>
            <a href="login.html">登录问题</a>
            <a href="admin.html">馆员入口</a>
            <a href="about.html">关于本系统</a>
          </div>
          <div>
            <h4>开放时间</h4>
            <p class="small">周一至周五 08:00–21:00<br>周六 09:00–17:00<br>周日及法定节假日闭馆</p>
            <p class="small" style="margin-top:10px">流通台：教学楼 A 座 1 层</p>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${new Date().getFullYear()} ${name} · ${sub}</span>
          <span>毕业设计作品 · 数据库课程实践</span>
        </div>
      </div>
    </footer>`;
}

/* ---------------- 空状态 ---------------- */
export function emptyHtml(text, sub = '') {
  return `<div class="empty">
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/>
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z"/>
    </svg>
    <p style="margin:0 0 4px;color:var(--ink-2)">${escapeHtml(text)}</p>
    ${sub ? `<p class="small" style="margin:0">${escapeHtml(sub)}</p>` : ''}
  </div>`;
}

/* ---------------- URL 参数 ---------------- */
export const params = () => new URLSearchParams(location.search);
export function setParams(patch) {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

/* 未登录时跳转到登录页并带回跳地址 */
export function requireLogin(me, back) {
  if (me) return true;
  const here = back || (location.pathname.split('/').pop() || 'index.html') + location.search;
  location.href = `login.html?next=${encodeURIComponent(here)}`;
  return false;
}
