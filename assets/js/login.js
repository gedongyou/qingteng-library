import { $, $$, api, mountHeader, mountFooter, toast, loadSite as loadSiteInfo } from './common.js';

await mountHeader({ active: '' });
mountFooter();
const siteInfo = await loadSiteInfo();

/* 借阅规则用真实配置渲染 */
const r = siteInfo.rules || {};
$('#rules-list').innerHTML = `
  <li><span>借期</span><b>${r.borrowDays || 30} 天</b></li>
  <li><span>续借</span><b>最多 ${r.renewTimes || 2} 次，每次 ${r.renewDays || 15} 天</b></li>
  <li><span>上限</span><b>同时 ${r.maxBorrow || 5} 册</b></li>
  <li><span>预约</span><b>到书后保留 ${r.reserveHoldDays || 3} 天</b></li>
  <li><span>逾期</span><b>每天 ${r.finePerDay ?? 0.2} 元（提示用）</b></li>`;

const next = new URLSearchParams(location.search).get('next');

$('#pwd-toggle').addEventListener('click', () => {
  const inp = $('#password');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('#pwd-toggle').textContent = show ? '隐藏' : '显示';
});

$$('.demo-list button').forEach((b) => b.addEventListener('click', () => {
  $('#cardNo').value = b.dataset.card;
  $('#password').value = b.dataset.pwd;
  $('#password').focus();
}));

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#err');
  const btn = $('#submit');
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = '登录中…';
  try {
    const r = await api('/api/login', {
      method: 'POST',
      body: { cardNo: $('#cardNo').value.trim(), password: $('#password').value },
    });
    toast(`欢迎回来，${r.user.name}`, 'ok');
    const role = r.user.role;
    setTimeout(() => {
      location.href = next || (role === 'reader' ? 'index.html' : 'admin.html');
    }, 400);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
    btn.disabled = false;
    btn.textContent = '登录';
  }
});
