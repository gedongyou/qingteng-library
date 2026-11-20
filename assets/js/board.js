/* 馆藏数字看板：一屏呈现馆藏规模、流通状况、分类分布、五心书架与借阅排行
   —— 数据来自本地接口 /api/board，30 秒轮询一次，不做任何网络请求之外的副作用 */
import { api, escapeHtml } from './common.js';
import { WUXIN } from './wuxin.js';

const $ = (s) => document.querySelector(s);

/* ---------------- 时钟 ---------------- */
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function tick() {
  const d = new Date();
  $('#b-time').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  $('#b-date').textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日　星期${WEEK[d.getDay()]}`;
}
tick();
setInterval(tick, 15000);

/* ---------------- 数字滚动 ---------------- */
function roll(el, to, { duration = 620 } = {}) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = String(to);
  // 先把最终值写上，保证任何环境下都不会停在 0；动画只是锦上添花
  el.textContent = to;
  if (from === to || !window.requestAnimationFrame) return;
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = to;
  };
  el.textContent = from;
  requestAnimationFrame(step);
  // 兜底：无论动画是否被节流，1 秒后一定是最终值
  setTimeout(() => { el.textContent = to; }, duration + 380);
}

/* ---------------- 主指标 ---------------- */
const KPI = [
  { k: 'copies', label: '馆藏总册', unit: '册', foot: (s) => `共 <b>${s.books}</b> 种书目`, accent: '#5fb896' },
  { k: 'available', label: '在架可借', unit: '册', foot: (s) => `占馆藏 <b>${pct(s.available, s.copies)}</b>`, accent: '#5fb896' },
  { k: 'borrowing', label: '当前外借', unit: '册', foot: (s) => `其中逾期 <b>${s.overdue}</b> 册`, accent: '#d98a63' },
  { k: 'readers', label: '注册读者', unit: '人', foot: (s) => `在借读者 <b>${s.readingReaders}</b> 人`, accent: '#7fa8cf' },
  { k: 'borrowTotal', label: '累计借出', unit: '次', foot: (s) => `人均 <b>${(s.borrowTotal / Math.max(1, s.readers)).toFixed(1)}</b> 次`, accent: '#d5b46a' },
  { k: 'categories', label: '开放分类', unit: '类', foot: (s) => `预约在办 <b>${s.reservations}</b> 条`, accent: '#7fa8cf' },
];

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + '%' : '—');

function renderKpi(s) {
  const host = $('#b-kpi');
  if (!host.dataset.ready) {
    host.innerHTML = KPI.map((k) => `
      <div class="kpi-tile" style="--accent:${k.accent}">
        <div class="k-label">${k.label}</div>
        <div class="k-value"><span data-n="${k.k}" data-v="0">0</span><span class="k-unit">${k.unit}</span></div>
        <div class="k-foot" data-f="${k.k}">—</div>
      </div>`).join('');
    host.dataset.ready = '1';
  }
  for (const k of KPI) {
    const el = document.querySelector(`[data-n="${k.k}"]`);
    if (el) roll(el, Number(s[k.k] || 0));
    const f = document.querySelector(`[data-f="${k.k}"]`);
    if (f) f.innerHTML = k.foot(s);
  }
}

/* ---------------- 分类分布 ---------------- */
function renderCats(rows) {
  const list = rows.filter((c) => c.copies > 0).slice(0, 9);
  const max = Math.max(...list.map((c) => c.copies), 1);
  $('#b-cats').innerHTML = `<div class="bcat">${list.map((c) => `
    <div class="bcat-row">
      <span class="nm" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
      <span class="track"><span class="fill" style="width:${Math.max(3, (c.copies / max) * 100)}%"></span></span>
      <span class="nm2">${c.copies}</span>
    </div>`).join('')}</div>`;
}

/* ---------------- 五心书架 ---------------- */
function renderWuxin(booksByCat) {
  const all = booksByCat.__all || [];
  const counts = all.reduce((m, b) => {
    const w = WUXIN.find((x) => x.books.includes(Number(b.id)));
    if (w) m[w.key] = (m[w.key] || 0) + 1;
    return m;
  }, {});
  $('#b-wuxin').innerHTML = `<div class="bwuxin">${WUXIN.map((w) => `
    <div class="bw-row" style="--c:${w.color}">
      <span class="xin">${w.name[0]}</span>
      <span class="info">
        <b>${w.motto}</b>
        <span>${w.tagline}</span>
      </span>
      <span class="cnt">${counts[w.key] || 0}<small>种</small></span>
    </div>`).join('')}</div>`;
}

/* ---------------- 借还趋势 ---------------- */
function renderTrend(trend) {
  const max = Math.max(...trend.map((t) => Math.max(t.borrow, t.return)), 1);
  $('#b-trend').innerHTML = `<div class="btrend">${trend.map((t) => {
    const h = (v) => (v === 0 ? 2 : Math.max(6, (v / max) * 100));
    return `<div class="bcol">
      <div class="pair">
        <span class="bar" style="height:${h(t.borrow)}%" title="借出 ${t.borrow}"></span>
        <span class="bar ret" style="height:${h(t.return)}%" title="归还 ${t.return}"></span>
      </div>
      <span class="dlabel">${t.date.slice(5).replace('-', '/')}</span>
    </div>`;
  }).join('')}</div>`;
}

/* ---------------- 借阅排行 ---------------- */
function renderTop(rows) {
  const list = rows.slice(0, 8);
  $('#b-top').innerHTML = `<div class="btop">${list.map((b, i) => `
    <div class="btop-row">
      <span class="no">${String(i + 1).padStart(2, '0')}</span>
      <span class="bk" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</span>
      <span class="times"><b>${b.times}</b> 次</span>
    </div>`).join('')}</div>`;
}

/* ---------------- 规则 ---------------- */
function renderRules(r) {
  const rows = [
    ['借期', `${r.borrowDays} 天`],
    ['单人上限', `${r.maxBorrow} 册`],
    ['续借', `${r.renewTimes} 次 × ${r.renewDays} 天`],
    ['逾期费', `￥${r.finePerDay} / 天`],
    ['预约保留', `${r.reserveHoldDays} 天`],
    ['同时预约', `${r.maxReserve} 种`],
    ['开馆', r.openHours || '—'],
  ];
  $('#b-rules').innerHTML = `<div class="brules">${rows.map(([k, v]) => `
    <div class="rrow"><span>${k}</span><b>${escapeHtml(v)}</b></div>`).join('')}</div>`;
}

/* ---------------- 拉数据 ---------------- */
async function refresh() {
  let d;
  try {
    d = await api('/api/board');
  } catch (err) {
    console.error('看板数据加载失败', err);
    return;
  }
  $('#b-site').textContent = d.siteName || '青藤图书室';
  $('#b-sub').textContent = `${d.siteSub || '校园图书借阅预约系统'} · 馆藏数字看板`;
  renderKpi(d.stats);
  renderCats(d.byCategory);

  // 五心书架的书种数：统计每颗心在馆藏里命中多少种
  try {
    const all = await api('/api/books?size=100');
    const items = all.items || [];
    renderWuxin({ __all: items });
  } catch { renderWuxin({ __all: [] }); }

  renderTrend(d.trend);
  renderTop(d.topBooks);
  renderRules(d.rules);
  $('#b-uptime').textContent = `数据更新于 ${new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false })}`;
}

refresh();
setInterval(refresh, 30000);
