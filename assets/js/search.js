import {
  $, $$, api, mountHeader, mountFooter, bookCard, escapeHtml, emptyHtml, params, setParams,
} from './common.js';
import { WUXIN } from './wuxin.js';

const me = await mountHeader();
mountFooter();

const state = {
  keyword: params().get('keyword') || '',
  category: params().get('category') || '',
  status: params().get('status') || '',
  sort: params().get('sort') || 'newest',
  wuxin: params().get('wuxin') || '',
  page: Number(params().get('page')) || 1,
  size: 12,
};

/* 分类下拉与侧栏 */
const cats = await api('/api/categories');
const catSel = $('#cat');
for (const c of cats) {
  const o = document.createElement('option');
  o.value = c.id;
  o.textContent = `${c.name}（${c.books}）`;
  catSel.appendChild(o);
}
$('#cat-nav').innerHTML = `
  <li><a href="#" data-cat="" class="${state.category ? '' : 'on'}">全部分类 <span class="n">${cats.reduce((s, c) => s + c.books, 0)}</span></a></li>
  ${cats.filter((c) => c.books > 0).map((c) => `
    <li><a href="#" data-cat="${c.id}" class="${String(c.id) === String(state.category) ? 'on' : ''}">
      ${escapeHtml(c.name)} <span class="n">${c.books}</span></a></li>`).join('')}`;

$('#kw').value = state.keyword;
catSel.value = state.category;
$('#status').value = state.status;
$('#sort').value = state.sort;

/* 五心书架筛选条 */
$('#wuxin-bar').innerHTML = `
  <span class="wb-label">主题书架</span>
  ${WUXIN.map((w) => `<button class="wb-chip ${state.wuxin === w.key ? 'on' : ''}"
      data-wx="${w.key}" style="--wx:${w.color}">
      <i>${w.name[0]}</i>${w.name}<em>${w.motto}</em></button>`).join('')}`;
$('#wuxin-bar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-wx]');
  if (!b) return;
  state.wuxin = state.wuxin === b.dataset.wx ? '' : b.dataset.wx;
  $$('#wuxin-bar .wb-chip').forEach((x) => x.classList.toggle('on', x.dataset.wx === state.wuxin));
  state.page = 1;
  go();
});

/* 事件 */
$('#filter-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.keyword = $('#kw').value.trim();
  state.page = 1;
  go();
});
for (const id of ['cat', 'status', 'sort']) {
  $('#' + id).addEventListener('change', () => {
    state.category = $('#cat').value;
    state.status = $('#status').value;
    state.sort = $('#sort').value;
    state.page = 1;
    go();
  });
}
$('#cat-nav').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-cat]');
  if (!a) return;
  e.preventDefault();
  state.category = a.dataset.cat;
  catSel.value = state.category;
  state.page = 1;
  go();
});
$('#clear').addEventListener('click', () => {
  Object.assign(state, { keyword: '', category: '', status: '', sort: 'newest', wuxin: '', page: 1 });
  $$('#wuxin-bar .wb-chip').forEach((x) => x.classList.remove('on'));
  $('#kw').value = ''; catSel.value = ''; $('#status').value = ''; $('#sort').value = 'newest';
  go();
});

function go() {
  setParams({
    keyword: state.keyword || null, category: state.category || null,
    status: state.status || null, sort: state.sort === 'newest' ? null : state.sort,
    wuxin: state.wuxin || null,
    page: state.page > 1 ? state.page : null,
  });
  render();
}

/* 渲染 */
async function render() {
  const listEl = $('#list');
  listEl.innerHTML = Array.from({ length: 8 }, () => `
    <article class="book-card"><div class="cover skeleton"></div>
      <div class="body"><div class="skeleton" style="height:15px;width:80%"></div>
      <div class="skeleton" style="height:12px;width:55%"></div></div></article>`).join('');

  const qs = new URLSearchParams({
    page: state.page, size: state.size, sort: state.sort,
    ...(state.keyword ? { keyword: state.keyword } : {}),
    ...(state.category ? { category: state.category } : {}),
    ...(state.status ? { status: state.status } : {}),
    ...(state.wuxin ? { wuxin: state.wuxin } : {}),
  });
  let data;
  try {
    data = await api('/api/books?' + qs);
  } catch (err) {
    listEl.innerHTML = emptyHtml('检索出错了', err.message);
    return;
  }

  // 侧栏高亮
  $$('#cat-nav a').forEach((a) => a.classList.toggle('on', a.dataset.cat === String(state.category)));

  const hasFilter = state.keyword || state.category || state.status || state.wuxin;
  $('#clear').hidden = !hasFilter;

  const catName = cats.find((c) => String(c.id) === String(state.category))?.name;
  const wxName = WUXIN.find((w) => w.key === state.wuxin)?.name;
  $('#result-summary').innerHTML = data.total === 0
    ? '没有找到符合条件的图书'
    : `找到 <b>${data.total}</b> 种图书` +
      (state.keyword ? `，关键词「${escapeHtml(state.keyword)}」` : '') +
      (catName ? `，分类「${escapeHtml(catName)}」` : '') +
      (wxName ? `，${wxName}主题书架` : '') +
      (state.status === 'available' ? '，仅看在架' : state.status === 'out' ? '，仅看已借完' : '') +
      `（第 ${data.page} / ${data.pages} 页）`;

  listEl.innerHTML = data.items.length
    ? data.items.map((b) => bookCardWithHit(b, state.keyword)).join('')
    : emptyHtml('没有匹配的图书', '换个关键词，或清除筛选条件再试');

  renderPager(data);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bookCardWithHit(b, kw) {
  const html = bookCard(b);
  if (!kw) return html;
  const safe = escapeHtml(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 只在标题与作者里做高亮，避免破坏 HTML 结构
  return html
    .replace(/(<h3><a[^>]*>)([^<]*)(<\/a>)/, (m, a, t, z) =>
      a + t.replace(new RegExp(`(${safe})`, 'gi'), '<mark>$1</mark>') + z)
    .replace(/(<div class="meta">)([^<]*)(<\/div>)/, (m, a, t, z) =>
      a + t.replace(new RegExp(`(${safe})`, 'gi'), '<mark>$1</mark>') + z);
}

function renderPager(data) {
  const el = $('#pager');
  if (data.pages <= 1) { el.innerHTML = ''; return; }
  const cur = data.page;
  let start = Math.max(1, cur - 2);
  let end = Math.min(data.pages, start + 4);
  start = Math.max(1, end - 4);

  let html = `<button data-p="${cur - 1}" ${cur === 1 ? 'disabled' : ''} aria-label="上一页">‹</button>`;
  if (start > 1) {
    html += `<button data-p="1">1</button>`;
    if (start > 2) html += `<span class="info">…</span>`;
  }
  for (let p = start; p <= end; p++) {
    html += `<button data-p="${p}" ${p === cur ? 'aria-current="true"' : ''}>${p}</button>`;
  }
  if (end < data.pages) {
    if (end < data.pages - 1) html += `<span class="info">…</span>`;
    html += `<button data-p="${data.pages}">${data.pages}</button>`;
  }
  html += `<button data-p="${cur + 1}" ${cur === data.pages ? 'disabled' : ''} aria-label="下一页">›</button>`;
  el.innerHTML = html;
  el.onclick = (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.p);
    go();
  };
}

render();
