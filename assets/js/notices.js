import { $, api, mountHeader, mountFooter, escapeHtml, fmtDate, emptyHtml, loadSite } from './common.js';

await mountHeader();
mountFooter();
const site = await loadSite();

const r = site.rules || {};
$('#rules-list').innerHTML = `
  <li><span>借期</span><b>${r.borrowDays || 30} 天</b></li>
  <li><span>续借次数</span><b>${r.renewTimes || 2} 次 / 每次 ${r.renewDays || 15} 天</b></li>
  <li><span>同时在借上限</span><b>${r.maxBorrow || 5} 册</b></li>
  <li><span>预约上限</span><b>${r.maxReserve || 3} 种</b></li>
  <li><span>到书保留</span><b>${r.reserveHoldDays || 3} 天</b></li>
  <li><span>逾期费</span><b>￥${r.finePerDay ?? 0.2} / 天</b></li>`;

$('#hours-list').innerHTML = `
  <li><span>周一至周五</span><b>08:00–21:00</b></li>
  <li><span>周六</span><b>09:00–17:00</b></li>
  <li><span>周日 / 节假日</span><b>闭馆</b></li>
  <li><span>寒暑假</span><b>每周二、四开放</b></li>`;

const notices = await api('/api/notices');
$('#notices').innerHTML = notices.length ? notices.map((n) => `
  <article class="notice-post ${n.pinned ? 'pinned' : ''}" id="n${n.id}">
    <h2>${n.pinned ? '<span class="tag tag-clay">置顶</span>' : ''}${escapeHtml(n.title)}</h2>
    <div class="meta"><span>${escapeHtml(n.author || '图书室')}</span><span>${fmtDate(n.createdAt)}</span></div>
    <div class="body">${escapeHtml(n.body)}</div>
  </article>`).join('') : emptyHtml('暂时没有公告');

// 支持 /notices#n3 定位
if (location.hash) {
  const el = document.querySelector(location.hash);
  if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
}
