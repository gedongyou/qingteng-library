/* 业务核心：借、还、续借、预约排队、到书保留、逾期计算、库存维护
   —— 1:1 移植自后端版的 server/services.js，规则与提示文案保持一致 */
import { load, save, table, find, insert, nextId, getSession, setSession, clearSession } from './db.js';
import { sha256Hex } from './sha256.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const iso = (d = new Date()) => d.toISOString();
const addDays = (date, days) => new Date(new Date(date).getTime() + days * 864e5);
const dayStr = (s) => (s ? new Date(s).toISOString().slice(0, 10) : '');

/* ---------------- 设置 ---------------- */
export function getSettings() {
  return load().settings || {};
}

export function getRules() {
  return getSettings().rules || {};
}

export function saveRules(patch) {
  const d = load();
  d.settings.rules = { ...getRules(), ...patch };
  save();
  return d.settings.rules;
}

export function setSetting(key, value) {
  const d = load();
  d.settings[key] = String(value);
  save();
}

export function getSetting(key, fallback = '') {
  const v = getSettings()[key];
  return v === undefined || v === null ? fallback : v;
}

/* ---------------- 操作日志 ---------------- */
export function log(actor, action, detail) {
  insert('logs', {
    at: iso(), actor: actor || 'system', action,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
  });
}

/* ---------------- 库存视图 ---------------- */
export function bookStock(bookId) {
  const copies = table('copies').filter((c) => Number(c.bookId) === Number(bookId));
  const count = (st) => copies.filter((c) => c.status === st).length;
  return {
    total: copies.length,
    available: count('available'),
    borrowed: count('borrowed'),
    reserved: count('reserved'),
    lost: count('lost'),
    repair: count('repair'),
  };
}

export function waitingCount(bookId) {
  return table('reservations').filter(
    (r) => Number(r.bookId) === Number(bookId) && r.status === 'waiting',
  ).length;
}

/* ---------------- 预约到期清理（惰性执行，每次相关操作前跑一遍） ---------------- */
export function sweep() {
  const now = iso();
  const d = load();
  const expired = d.reservations.filter(
    (r) => r.status === 'ready' && r.expireAt && r.expireAt < now,
  );
  for (const r of expired) {
    r.status = 'expired';
    const copy = d.copies
      .filter((c) => Number(c.bookId) === Number(r.bookId) && c.status === 'reserved')
      .sort((a, b) => a.id - b.id)[0];
    if (copy) {
      copy.status = 'available';
      promoteReservation(r.bookId);
    }
    log('system', 'reservation.expired', `预约 #${r.id} 超期未取，自动取消`);
  }
  if (expired.length) save();
}

/** 有可用副本时，把副本锁给队首预约者（默认 3 天内到馆取书） */
export function promoteReservation(bookId) {
  const d = load();
  const rules = getRules();
  for (;;) {
    const copy = d.copies
      .filter((c) => Number(c.bookId) === Number(bookId) && c.status === 'available')
      .sort((a, b) => a.id - b.id)[0];
    if (!copy) break;
    const next = d.reservations
      .filter((r) => Number(r.bookId) === Number(bookId) && r.status === 'waiting')
      .sort((a, b) => a.queueNo - b.queueNo || String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    if (!next) break;
    const ready = new Date();
    next.status = 'ready';
    next.readyAt = ready.toISOString();
    next.expireAt = addDays(ready, rules.reserveHoldDays || 3).toISOString();
    copy.status = 'reserved';
    save();
    return next;
  }
  return null;
}

/* ---------------- 借阅统计 ---------------- */
export function userBorrowStats(userId) {
  const rows = table('borrows').filter(
    (b) => Number(b.userId) === Number(userId) && b.status === 'borrowed',
  );
  const now = new Date();
  const overdue = rows.filter((b) => new Date(b.dueAt) < now);
  return {
    active: rows.length,
    overdue: overdue.length,
    overdueDays: overdue.reduce((s, b) => s + Math.ceil((now - new Date(b.dueAt)) / 864e5), 0),
  };
}

/* ---------------- 借书 ---------------- */
export function borrowBook({ userId, bookId, copyBarcode, operator = 'self' }) {
  sweep();
  const d = load();
  const rules = getRules();
  const user = find('users', userId);
  if (!user) throw new ApiError(404, '读者不存在');
  if (user.status !== 'active') throw new ApiError(403, '该借书证已被冻结');

  if (!bookId && copyBarcode) {
    const c = table('copies').find((x) => x.barcode === copyBarcode);
    if (!c) throw new ApiError(404, `没有条码为 ${copyBarcode} 的馆藏`);
    bookId = c.bookId;
  }
  if (!bookId) throw new ApiError(400, '缺少图书');

  const stats = userBorrowStats(userId);
  const limit = user.maxBorrow || rules.maxBorrow || 5;
  if (stats.active >= limit) throw new ApiError(400, `已达借阅上限（${limit} 册），请先归还`);
  if (stats.overdue > 0) throw new ApiError(400, '有逾期未还图书，请先归还后再借');

  const dup = d.borrows.some(
    (b) => Number(b.userId) === Number(userId) && Number(b.bookId) === Number(bookId) && b.status === 'borrowed',
  );
  if (dup) throw new ApiError(400, '这本书你已经借着，同一本书不重复借阅');

  const myReady = d.reservations
    .filter((r) => Number(r.userId) === Number(userId) && Number(r.bookId) === Number(bookId) && r.status === 'ready')
    .sort((a, b) => a.queueNo - b.queueNo)[0];

  let copy;
  if (copyBarcode) {
    copy = d.copies.find((c) => c.barcode === copyBarcode && Number(c.bookId) === Number(bookId));
    if (!copy) throw new ApiError(404, '该书没有这个条码的副本');
    if (copy.status !== 'available' && !(copy.status === 'reserved' && myReady)) {
      throw new ApiError(409, '该册当前不可借（已借出或已为他人预留）');
    }
  } else if (myReady) {
    copy = d.copies
      .filter((c) => Number(c.bookId) === Number(bookId) && c.status === 'reserved')
      .sort((a, b) => a.id - b.id)[0];
  }
  if (!copy) {
    copy = d.copies
      .filter((c) => Number(c.bookId) === Number(bookId) && c.status === 'available')
      .sort((a, b) => a.id - b.id)[0];
  }
  if (!copy) {
    const waiting = waitingCount(bookId);
    throw new ApiError(409, waiting > 0 ? `暂无在架副本，当前还有 ${waiting} 人在排队预约` : '暂无在架副本');
  }

  const now = new Date();
  const due = addDays(now, rules.borrowDays || 30);
  const rec = insert('borrows', {
    userId: Number(userId), copyId: copy.id, bookId: Number(bookId),
    borrowedAt: now.toISOString(), dueAt: due.toISOString(), returnedAt: null,
    renewCount: 0, operator, returnOp: null, status: 'borrowed',
  });
  copy.status = 'borrowed';
  if (myReady) myReady.status = 'fulfilled';
  save();
  promoteReservation(bookId);

  const book = find('books', bookId);
  log(operator === 'self' ? user.cardNo : operator, 'borrow',
    `${user.name}(${user.cardNo}) 借《${book ? book.title : bookId}》 条码 ${copy.barcode} 应还 ${dayStr(due)}`);
  return { borrowId: rec.id, dueAt: due.toISOString(), barcode: copy.barcode };
}

/* ---------------- 还书 ---------------- */
export function returnBook({ barcode, borrowId, operator = 'staff' }) {
  const d = load();
  let borrow;
  if (borrowId) {
    borrow = d.borrows.find((b) => Number(b.id) === Number(borrowId) && b.status === 'borrowed');
  } else if (barcode) {
    const copy = d.copies.find((c) => c.barcode === barcode);
    if (!copy) throw new ApiError(404, `没有条码为 ${barcode} 的馆藏`);
    borrow = d.borrows.find((b) => Number(b.copyId) === copy.id && b.status === 'borrowed');
    if (!borrow) throw new ApiError(400, '该册当前不在借出状态');
  }
  if (!borrow) throw new ApiError(404, '没找到对应的借阅记录');

  const now = new Date();
  const due = new Date(borrow.dueAt);
  const overdueDays = Math.max(0, Math.ceil((now - due) / 864e5));
  const rules = getRules();
  const fine = +(overdueDays * (rules.finePerDay || 0)).toFixed(2);

  borrow.status = 'returned';
  borrow.returnedAt = now.toISOString();
  borrow.returnOp = operator;
  const copy = find('copies', borrow.copyId);
  if (copy) copy.status = 'available';
  save();
  promoteReservation(borrow.bookId);

  const user = find('users', borrow.userId);
  const book = find('books', borrow.bookId);
  log(operator, 'return',
    `${user ? user.name : '读者'} 归还《${book ? book.title : borrow.bookId}》${overdueDays ? `，逾期 ${overdueDays} 天，应付 ${fine} 元` : ''}`);
  return {
    ok: true, overdueDays, fine,
    bookTitle: book ? book.title : '',
    userName: user ? user.name : '',
  };
}

/* ---------------- 续借 ---------------- */
export function renewBorrow({ borrowId, userId }) {
  const rules = getRules();
  const b = find('borrows', borrowId);
  if (!b) throw new ApiError(404, '借阅记录不存在');
  if (userId && Number(b.userId) !== Number(userId)) throw new ApiError(403, '只能续借自己的图书');
  if (b.status !== 'borrowed') throw new ApiError(400, '该记录已归还');
  if (new Date(b.dueAt) < new Date()) throw new ApiError(400, '已逾期，请到图书室办理归还');
  if (b.renewCount >= (rules.renewTimes || 2)) throw new ApiError(400, `最多续借 ${rules.renewTimes} 次`);
  const waiting = waitingCount(b.bookId);
  if (waiting > 0) throw new ApiError(400, `该书有 ${waiting} 人预约，不能续借`);

  const due = addDays(b.dueAt, rules.renewDays || 15);
  b.dueAt = due.toISOString();
  b.renewCount = (b.renewCount || 0) + 1;
  save();
  const u = find('users', b.userId);
  log(u ? u.cardNo : 'system', 'renew',
    `${u ? u.name : '读者'} 续借借阅 #${b.id}，新应还日期 ${dayStr(due)}`);
  return { dueAt: due.toISOString(), renewCount: b.renewCount };
}

/* ---------------- 预约 ---------------- */
export function reserveBook({ userId, bookId }) {
  sweep();
  const d = load();
  const rules = getRules();
  const book = find('books', bookId);
  if (!book) throw new ApiError(404, '图书不存在');

  const dup = d.reservations.some(
    (r) => Number(r.userId) === Number(userId) && Number(r.bookId) === Number(bookId)
      && ['waiting', 'ready'].includes(r.status),
  );
  if (dup) throw new ApiError(400, '你已经预约过这本书了');

  const borrowing = d.borrows.some(
    (b) => Number(b.userId) === Number(userId) && Number(b.bookId) === Number(bookId) && b.status === 'borrowed',
  );
  if (borrowing) throw new ApiError(400, '这本书正在你手上，无需预约');

  const mine = d.reservations.filter(
    (r) => Number(r.userId) === Number(userId) && ['waiting', 'ready'].includes(r.status),
  ).length;
  if (mine >= (rules.maxReserve || 3)) throw new ApiError(400, `最多同时预约 ${rules.maxReserve} 种图书`);

  const stock = bookStock(bookId);
  const maxQueue = d.reservations
    .filter((r) => Number(r.bookId) === Number(bookId) && ['waiting', 'ready'].includes(r.status))
    .reduce((m, r) => Math.max(m, r.queueNo || 0), 0);
  const queueNo = maxQueue + 1;
  const now = new Date();

  const rec = insert('reservations', {
    userId: Number(userId), bookId: Number(bookId), createdAt: now.toISOString(),
    readyAt: null, expireAt: null, status: 'waiting', queueNo,
  });

  let ready = false;
  if (stock.available > 0) {
    const copy = d.copies
      .filter((c) => Number(c.bookId) === Number(bookId) && c.status === 'available')
      .sort((a, b) => a.id - b.id)[0];
    if (copy) {
      copy.status = 'reserved';
      rec.status = 'ready';
      rec.readyAt = now.toISOString();
      rec.expireAt = addDays(now, rules.reserveHoldDays || 3).toISOString();
      ready = true;
      save();
    }
  }
  const u = find('users', userId);
  log(u ? u.cardNo : 'system', 'reserve',
    `${u ? u.name : '读者'} 预约《${book.title}》，队号 ${queueNo}${ready ? '（已在架，直接锁定）' : ''}`);
  return { id: rec.id, queueNo, ready };
}

export function cancelReservation({ id, userId, byStaff = false }) {
  const r = find('reservations', id);
  if (!r) throw new ApiError(404, '预约不存在');
  if (!byStaff && Number(r.userId) !== Number(userId)) throw new ApiError(403, '只能取消自己的预约');
  if (!['waiting', 'ready'].includes(r.status)) throw new ApiError(400, '该预约已结束');

  const wasReady = r.status === 'ready';
  r.status = 'cancelled';
  save();
  if (wasReady) {
    const copy = table('copies')
      .filter((c) => Number(c.bookId) === Number(r.bookId) && c.status === 'reserved')
      .sort((a, b) => a.id - b.id)[0];
    if (copy) { copy.status = 'available'; save(); }
    promoteReservation(r.bookId);
  }
  const u = find('users', r.userId);
  log(u ? u.cardNo : 'system', 'reservation.cancel', `取消预约 #${id}`);
  return { ok: true };
}

/* ---------------- 图书与库存维护 ---------------- */
export function addCopies(bookId, n, startNo) {
  const d = load();
  const book = find('books', bookId);
  if (!book) throw new ApiError(404, '图书不存在');
  const prefix = `${book.isbn ? String(book.isbn).slice(-4) : '0000'}-${String(bookId).padStart(3, '0')}`;
  let seq = startNo ?? (d.copies.filter((c) => Number(c.bookId) === Number(bookId)).length + 1);
  for (let i = 0; i < n; i++) {
    let barcode;
    let guard = 0;
    do {
      barcode = `B${prefix}-${String(seq++).padStart(2, '0')}`;
      guard++;
    } while (d.copies.some((c) => c.barcode === barcode) && guard < 500);
    insert('copies', {
      bookId: Number(bookId), barcode, status: 'available', createdAt: iso(),
    });
  }
  syncTotal(bookId);
}

export function syncTotal(bookId) {
  const book = find('books', bookId);
  if (!book) return;
  book.totalCopies = table('copies').filter((c) => Number(c.bookId) === Number(bookId)).length;
  book.updatedAt = iso();
  save();
}

export function setCopyStatus(copyId, status, actor) {
  const copy = find('copies', copyId);
  if (!copy) throw new ApiError(404, '副本不存在');
  if (copy.status === 'borrowed' && status !== 'borrowed') {
    throw new ApiError(400, '该册正在借出，请先办理归还');
  }
  copy.status = status;
  save();
  if (status === 'available') promoteReservation(copy.bookId);
  log(actor, 'copy.status', `条码 ${copy.barcode} → ${status}`);
  return { ok: true };
}

/* ---------------- 密码 ----------------
   注意：crypto.subtle 只在安全上下文（https / localhost）可用。
   局域网 http://192.168.x.x 打开时它是 undefined，所以走 sha256.js 的纯 JS 实现。 */
export async function hashPassword(pwd, salt) {
  const useSalt = salt || Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const hash = await sha256Hex(useSalt + pwd);
  return { salt: useSalt, hash };
}

export async function verifyPassword(user, pwd) {
  const { hash } = await hashPassword(pwd, user.salt);
  return hash === user.password;
}

/* ---------------- 会话 ---------------- */
export function currentUser() {
  const s = getSession();
  if (!s) return null;
  const u = find('users', s.userId);
  if (!u) return null;
  return u;
}

export async function login(cardNo, password) {
  const key = String(cardNo || '').trim();
  const user = table('users').find((u) => u.cardNo === key || u.name === key);
  if (!user || !(await verifyPassword(user, String(password)))) {
    throw new ApiError(401, '借书证号或密码不正确');
  }
  if (user.status !== 'active' && user.role === 'reader') {
    throw new ApiError(403, '该借书证已被冻结，请联系图书室');
  }
  setSession(user.id);
  user.lastLogin = iso();
  save();
  log(user.cardNo, 'login', `${user.name} 登录`);
  return user;
}

export function logout() {
  const u = currentUser();
  if (u) log(u.cardNo, 'logout', `${u.name} 退出登录`);
  clearSession();
}

export function requireUser() {
  const u = currentUser();
  if (!u) throw new ApiError(401, '请先登录');
  return u;
}

export function requireRole(roles) {
  const u = requireUser();
  if (!roles.includes(u.role)) throw new ApiError(403, '没有该操作权限');
  return u;
}

export const isStaff = (u) => !!u && (u.role === 'librarian' || u.role === 'admin');
export { nextId };
