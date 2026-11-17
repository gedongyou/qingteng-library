import {
  $, api, mountHeader, mountFooter, bookCard, escapeHtml, fmtRel, emptyHtml,
} from './common.js';

const me = await mountHeader({ active: '/' });
mountFooter();

document.querySelectorAll('[data-fill]').forEach((el) => { el.textContent = '—'; });

const [overview, cats] = await Promise.all([
  api('/api/overview'),
  api('/api/categories'),
]);

/* ---------- 实时数据 ---------- */
const { stats, rules } = overview;
for (const el of document.querySelectorAll('[data-k]')) {
  const v = stats[el.dataset.k];
  el.textContent = v ?? '—';
}
document.querySelectorAll('[data-fill="books"]').forEach((e) => { e.textContent = stats.books; });
document.querySelectorAll('[data-fill="copies"]').forEach((e) => { e.textContent = stats.copies; });

$('#rule-days').textContent = `${rules.borrowDays} 天`;
$('#rule-renew').textContent = `${rules.renewTimes} 次`;
$('#rule-max').textContent = `${rules.maxBorrow} 册`;

const t = new Date();
$('#updated-at').textContent = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 更新`;

/* ---------- 分类 ---------- */
$('#cat-grid').innerHTML = cats
  .filter((c) => c.books > 0)
  .slice(0, 12)
  .map((c) => `
    <a class="cat-item" href="search.html?category=${c.id}">
      <span class="code">${escapeHtml(c.code || '')}</span>
      <b>${escapeHtml(c.name)}</b>
      <span>${c.books} 种</span>
    </a>`).join('');

/* ---------- 新书 / 热门 / 公告 ---------- */
$('#latest-grid').innerHTML = overview.latest.map(bookCard).join('');

$('#hot-list').innerHTML = overview.hot.map((b, i) => `
  <li>
    <span class="n">${String(i + 1).padStart(2, '0')}</span>
    <span class="t">
      <a href="book.html?id=${b.id}">${escapeHtml(b.title)}</a>
      <small>${escapeHtml(b.author || '佚名')}</small>
    </span>
    <span class="c">借出 ${b.times} 次</span>
  </li>`).join('');

$('#notice-list').innerHTML = overview.notices.length
  ? overview.notices.map((n) => `
    <a class="notice-item" href="notices.html#n${n.id}">
      <div class="h">
        ${n.pinned ? '<span class="tag tag-clay">置顶</span>' : ''}
        <h3>${escapeHtml(n.title)}</h3>
      </div>
      <p>${escapeHtml(n.body.replace(/\n/g, ' ').slice(0, 90))}</p>
      <time>${fmtRel(n.createdAt)}</time>
    </a>`).join('')
  : emptyHtml('暂时没有公告');

/* ---------- 搜索 ---------- */
const form = $('#hero-search');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const kw = $('#q').value.trim();
  location.href = 'search.html' + (kw ? `?keyword=${encodeURIComponent(kw)}` : '');
});
