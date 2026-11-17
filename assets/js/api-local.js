/* 本地「接口层」：把原来 /api/* 的全部路由搬到浏览器里
   —— common.js 的 api() 会调用这里的 dispatch()，页面代码完全不用改 */
import { load, save, table, find, insert, remove, nextId, flush, resetDb, clone } from './db.js';
import {
  ApiError, getRules, saveRules, getSetting, setSetting, log,
  bookStock, waitingCount, sweep, promoteReservation, userBorrowStats,
  borrowBook, returnBook, renewBorrow, reserveBook, cancelReservation,
  addCopies, syncTotal, setCopyStatus,
  hashPassword, verifyPassword, currentUser, login, logout,
  requireUser, requireRole, isStaff,
} from './store.js';

const now = () => new Date().toISOString();

/* ============================ 序列化 ============================ */

const publicUser = (u) => ({
  id: u.id, cardNo: u.cardNo, name: u.name, role: u.role, dept: u.dept,
  phone: u.phone, status: u.status, maxBorrow: u.maxBorrow,
});

function categoryName(id) {
  const c = find('categories', id);
  return c ? c.name : null;
}

function bookCard(b, user) {
  const stock = bookStock(b.id);
  const waiting = waitingCount(b.id);
  const out = {
    id: b.id, isbn: b.isbn, title: b.title, author: b.author, publisher: b.publisher,
    pubYear: b.pubYear, categoryId: b.categoryId, category: categoryName(b.categoryId),
    price: b.price, cover: b.cover, tags: b.tags, location: b.location,
    total: stock.total, available: stock.available, borrowed: stock.borrowed,
    reserved: stock.reserved, lost: stock.lost, repair: stock.repair,
    waiting, summary: b.summary,
    status: stock.available > 0 ? 'available' : (stock.total === 0 ? 'none' : 'out'),
  };
  if (user) {
    out.myBorrow = table('borrows').find(
      (x) => Number(x.userId) === Number(user.id) && Number(x.bookId) === Number(b.id) && x.status === 'borrowed',
    ) || null;
    out.myReservation = table('reservations').find(
      (x) => Number(x.userId) === Number(user.id) && Number(x.bookId) === Number(b.id)
        && ['waiting', 'ready'].includes(x.status),
    ) || null;
  }
  return out;
}

/* ============================ 工具 ============================ */

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const like = (hay, kw) => String(hay ?? '').toLowerCase().includes(String(kw).toLowerCase());

function todayStr() { return new Date().toISOString().slice(0, 10); }

function toCsv(rows) {
  if (!rows.length) return '';
  const heads = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [heads.join(','), ...rows.map((r) => heads.map((h) => esc(r[h])).join(','))].join('\r\n');
}

/* 路由表：把 '/api/books/:id' 编译成正则 */
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}
const GET = (p, h) => route('GET', p, h);
const POST = (p, h) => route('POST', p, h);
const PUT = (p, h) => route('PUT', p, h);
const PATCH = (p, h) => route('PATCH', p, h);
const DEL = (p, h) => route('DELETE', p, h);

/* ============================ 接口实现 ============================ */

/* ---------- 会话 ---------- */
POST('/api/login', async ({ body }) => {
  const { cardNo, password } = body || {};
  if (!cardNo || !password) throw new ApiError(400, '请输入借书证号与密码');
  const user = await login(cardNo, password);
  return { user: publicUser(user) };
});

POST('/api/logout', () => {
  logout();
  return { ok: true };
});

GET('/api/me', () => {
  const u = currentUser();
  if (!u) return { user: null };
  return { user: publicUser(u), stats: userBorrowStats(u.id) };
});

GET('/api/site', () => {
  const rules = getRules();
  return {
    siteName: getSetting('siteName'), siteSub: getSetting('siteSub'),
    noticeBar: getSetting('noticeBar'), rules, openHours: rules.openHours,
  };
});

/* ---------- 前台：图书检索 ---------- */
GET('/api/books', ({ query }) => {
  const q = query;
  let rows = table('books').map((b) => ({ ...b, _stock: bookStock(b.id) }));

  if (q.keyword) {
    const kw = q.keyword.trim();
    rows = rows.filter((b) => like(b.title, kw) || like(b.author, kw) || like(b.isbn, kw)
      || like(b.tags, kw) || like(b.publisher, kw));
  }
  if (q.category) rows = rows.filter((b) => Number(b.categoryId) === Number(q.category));
  if (q.status === 'available') rows = rows.filter((b) => b._stock.available > 0);
  if (q.status === 'out') rows = rows.filter((b) => b._stock.available === 0);

  const borrowCount = (id) => table('borrows').filter((x) => Number(x.bookId) === Number(id)).length;
  const sorters = {
    newest: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id - a.id,
    title: (a, b) => String(a.title).localeCompare(String(b.title), 'zh-Hans-CN'),
    hot: (a, b) => borrowCount(b.id) - borrowCount(a.id) || a.id - b.id,
    available: (a, b) => b._stock.available - a._stock.available || a.id - b.id,
  };
  rows.sort(sorters[q.sort] || ((a, b) => a.id - b.id));

  const page = Math.max(1, Number(q.page) || 1);
  const size = Math.min(100, Math.max(1, Number(q.size) || 12));
  const total = rows.length;
  const items = rows.slice((page - 1) * size, page * size);

  const user = currentUser();
  return {
    total, page, size, pages: Math.ceil(total / size) || 1,
    items: items.map((b) => bookCard(b, user)),
    categories: table('categories').slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)),
  };
});

GET('/api/books/:id', ({ params }) => {
  const b = find('books', Number(params.id));
  if (!b) throw new ApiError(404, '图书不存在');
  const user = currentUser();
  const copies = table('copies')
    .filter((c) => Number(c.bookId) === Number(b.id))
    .sort((x, y) => String(x.barcode).localeCompare(String(y.barcode)));
  const related = table('books')
    .filter((x) => Number(x.categoryId) === Number(b.categoryId) && Number(x.id) !== Number(b.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, 4);
  const history = table('borrows').filter((x) => Number(x.bookId) === Number(b.id));
  const lastBorrowed = history.reduce((m, x) => (String(x.borrowedAt) > String(m) ? x.borrowedAt : m), '');
  return {
    book: bookCard(b, user),
    copies: copies.map((c) => ({ id: c.id, barcode: c.barcode, status: c.status })),
    related: related.map((r) => bookCard(r, user)),
    borrowTimes: history.length,
    lastBorrowed: lastBorrowed || null,
    rules: getRules(),
  };
});

GET('/api/categories', () => table('categories')
  .slice()
  .sort((a, b) => (a.sort || 0) - (b.sort || 0))
  .map((c) => ({ ...c, books: table('books').filter((b) => Number(b.categoryId) === Number(c.id)).length })));

GET('/api/notices', () => table('notices')
  .slice()
  .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.createdAt).localeCompare(String(a.createdAt))));

GET('/api/overview', () => {
  const s = load();
  const stats = {
    books: s.books.length,
    copies: s.copies.length,
    readers: s.users.filter((u) => u.role === 'reader').length,
    borrowing: s.borrows.filter((b) => b.status === 'borrowed').length,
    availableCopies: s.copies.filter((c) => c.status === 'available').length,
    reservations: s.reservations.filter((r) => ['waiting', 'ready'].includes(r.status)).length,
  };
  const cnt = new Map();
  for (const br of s.borrows) cnt.set(br.bookId, (cnt.get(br.bookId) || 0) + 1);
  const hot = s.books
    .map((b) => ({ id: b.id, title: b.title, author: b.author, times: cnt.get(b.id) || 0 }))
    .sort((a, b) => b.times - a.times || a.id - b.id)
    .slice(0, 6);
  const latest = s.books
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id - a.id)
    .slice(0, 6);
  const notices = table('notices')
    .slice()
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 3);
  return { stats, hot, latest: latest.map((b) => bookCard(b, null)), rules: getRules(), notices };
});

/* ---------- 读者：我的书房 ---------- */
GET('/api/my', () => {
  const u = requireUser();
  const rules = getRules();
  sweep();
  const borrowRows = table('borrows')
    .filter((b) => Number(b.userId) === Number(u.id))
    .sort((a, b) => (b.status === 'borrowed' ? 1 : 0) - (a.status === 'borrowed' ? 1 : 0)
      || String(a.dueAt).localeCompare(String(b.dueAt)));

  const today = new Date();
  const list = borrowRows.map((b) => {
    const book = find('books', b.bookId) || {};
    const copy = find('copies', b.copyId) || {};
    const due = new Date(b.dueAt);
    const overdueDays = b.status === 'borrowed' ? Math.max(0, Math.ceil((today - due) / 864e5)) : 0;
    return {
      id: b.id, title: book.title, author: book.author, cover: book.cover, barcode: copy.barcode,
      borrowedAt: b.borrowedAt, dueAt: b.dueAt, returnedAt: b.returnedAt,
      renewCount: b.renewCount, maxRenew: rules.renewTimes, status: b.status,
      overdueDays, fine: +(overdueDays * rules.finePerDay).toFixed(2),
      canRenew: b.status === 'borrowed' && overdueDays === 0 && b.renewCount < rules.renewTimes
        && waitingCount(b.bookId) === 0,
    };
  });

  const reservations = table('reservations')
    .filter((r) => Number(r.userId) === Number(u.id))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((r) => {
      const book = find('books', r.bookId) || {};
      const position = r.status === 'waiting'
        ? table('reservations').filter((x) => Number(x.bookId) === Number(r.bookId)
          && x.status === 'waiting' && x.queueNo <= r.queueNo).length
        : null;
      return { ...r, title: book.title, author: book.author, cover: book.cover, position };
    });

  return {
    user: publicUser(u), stats: userBorrowStats(u.id), rules,
    borrows: list, reservations,
    history: list.filter((b) => b.status === 'returned').length,
  };
});

POST('/api/borrow', ({ body }) => {
  const u = requireUser();
  return borrowBook({
    userId: u.id, bookId: Number(body.bookId), copyBarcode: body.barcode, operator: u.cardNo,
  });
});

POST('/api/return', ({ body }) => {
  const u = requireUser();
  const borrowId = body.borrowId ? Number(body.borrowId) : null;
  if (borrowId) {
    const b = find('borrows', borrowId);
    if (!b) throw new ApiError(404, '借阅记录不存在');
    if (Number(b.userId) !== Number(u.id) && !isStaff(u)) throw new ApiError(403, '只能归还自己的图书');
  }
  return returnBook({ borrowId, barcode: body.barcode, operator: u.cardNo });
});

POST('/api/renew', ({ body }) => {
  const u = requireUser();
  return renewBorrow({ borrowId: Number(body.borrowId), userId: isStaff(u) ? null : u.id });
});

POST('/api/reserve', ({ body }) => {
  const u = requireUser();
  return reserveBook({ userId: u.id, bookId: Number(body.bookId) });
});

POST('/api/reserve/cancel', ({ body }) => {
  const u = requireUser();
  return cancelReservation({ id: Number(body.id), userId: u.id, byStaff: isStaff(u) });
});

POST('/api/password', async ({ body }) => {
  const u = requireUser();
  const { oldPassword, newPassword } = body;
  if (!(await verifyPassword(u, String(oldPassword || '')))) throw new ApiError(400, '原密码不正确');
  if (!newPassword || String(newPassword).length < 6) throw new ApiError(400, '新密码至少 6 位');
  const { hash, salt } = await hashPassword(String(newPassword));
  u.password = hash;
  u.salt = salt;
  save();
  log(u.cardNo, 'password', '修改密码');
  return { ok: true };
});

/* ============================ 管理端 ============================ */
const STAFF = ['librarian', 'admin'];

GET('/api/admin/dashboard', () => {
  requireRole(STAFF);
  sweep();
  const s = load();
  const today = todayStr();
  const stats = {
    books: s.books.length,
    copies: s.copies.length,
    readers: s.users.filter((u) => u.role === 'reader').length,
    borrowing: s.borrows.filter((b) => b.status === 'borrowed').length,
    overdue: s.borrows.filter((b) => b.status === 'borrowed' && b.dueAt < now()).length,
    available: s.copies.filter((c) => c.status === 'available').length,
    reserved: s.reservations.filter((r) => r.status === 'ready').length,
    waiting: s.reservations.filter((r) => r.status === 'waiting').length,
    todayBorrow: s.borrows.filter((b) => String(b.borrowedAt).slice(0, 10) === today).length,
    todayReturn: s.borrows.filter((b) => b.returnedAt && String(b.returnedAt).slice(0, 10) === today).length,
    lost: s.copies.filter((c) => c.status === 'lost').length,
  };
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    trend.push({
      date: d,
      borrow: s.borrows.filter((b) => String(b.borrowedAt).slice(0, 10) === d).length,
      return: s.borrows.filter((b) => b.returnedAt && String(b.returnedAt).slice(0, 10) === d).length,
    });
  }
  const byCategory = table('categories').map((c) => {
    const books = s.books.filter((b) => Number(b.categoryId) === Number(c.id));
    const ids = new Set(books.map((b) => b.id));
    return {
      name: c.name, books: books.length,
      available: s.copies.filter((cp) => ids.has(cp.bookId) && cp.status === 'available').length,
    };
  }).sort((a, b) => b.books - a.books || a.name.localeCompare(b.name));

  const cnt = new Map();
  for (const br of s.borrows) cnt.set(br.bookId, (cnt.get(br.bookId) || 0) + 1);
  const hot = s.books
    .map((b) => ({ id: b.id, title: b.title, author: b.author, times: cnt.get(b.id) || 0 }))
    .sort((a, b) => b.times - a.times || a.id - b.id)
    .slice(0, 8);
  const recentLogs = table('logs').slice().sort((a, b) => b.id - a.id).slice(0, 12);
  return { stats, trend, byCategory, hot, recentLogs, rules: getRules() };
});

/* ---------- 图书管理 ---------- */
GET('/api/admin/books', ({ query }) => {
  requireRole(STAFF);
  const q = query;
  let rows = table('books').slice();
  if (q.keyword) {
    const kw = q.keyword.trim();
    rows = rows.filter((b) => like(b.title, kw) || like(b.author, kw) || like(b.isbn, kw) || like(b.tags, kw));
  }
  if (q.category) rows = rows.filter((b) => Number(b.categoryId) === Number(q.category));
  if (q.stock === 'out') rows = rows.filter((b) => bookStock(b.id).available === 0);
  rows.sort((a, b) => b.id - a.id);

  const page = Math.max(1, Number(q.page) || 1);
  const size = Math.min(100, Math.max(1, Number(q.size) || 15));
  const total = rows.length;
  return {
    total, page, size, pages: Math.ceil(total / size) || 1,
    items: rows.slice((page - 1) * size, page * size)
      .map((b) => ({ ...bookCard(b, null), createdAt: b.createdAt })),
  };
});

POST('/api/admin/books', ({ body }) => {
  const u = requireRole(STAFF);
  if (!body.title) throw new ApiError(400, '书名必填');
  const rec = insert('books', {
    isbn: body.isbn || null, title: body.title, author: body.author || null,
    publisher: body.publisher || null, pubYear: num(body.pubYear),
    categoryId: num(body.categoryId), price: num(body.price),
    summary: body.summary || null, cover: body.cover || null,
    tags: body.tags || null, location: body.location || null,
    totalCopies: 0, createdAt: now(), updatedAt: now(),
  });
  addCopies(rec.id, Math.max(1, Number(body.copies) || 1));
  log(u.cardNo, 'book.create', `新增图书《${body.title}》`);
  return { id: rec.id, ...bookCard(find('books', rec.id), null) };
});

PUT('/api/admin/books/:id', ({ params, body }) => {
  const u = requireRole(STAFF);
  const b = find('books', Number(params.id));
  if (!b) throw new ApiError(404, '图书不存在');
  Object.assign(b, {
    isbn: body.isbn ?? b.isbn, title: body.title ?? b.title,
    author: body.author ?? b.author, publisher: body.publisher ?? b.publisher,
    pubYear: body.pubYear !== undefined ? num(body.pubYear) : b.pubYear,
    categoryId: body.categoryId !== undefined ? num(body.categoryId) : b.categoryId,
    price: body.price !== undefined ? num(body.price) : b.price,
    summary: body.summary ?? b.summary, cover: body.cover ?? b.cover,
    tags: body.tags ?? b.tags, location: body.location ?? b.location,
    updatedAt: now(),
  });
  save();
  log(u.cardNo, 'book.update', `修改图书《${body.title || b.title}》`);
  return bookCard(b, null);
});

DEL('/api/admin/books/:id', ({ params }) => {
  const u = requireRole(['admin']);
  const b = find('books', Number(params.id));
  if (!b) throw new ApiError(404, '图书不存在');
  const active = table('borrows').filter(
    (x) => Number(x.bookId) === Number(b.id) && x.status === 'borrowed',
  ).length;
  if (active > 0) throw new ApiError(400, `还有 ${active} 册在借，不能删除`);
  const d = load();
  d.books = d.books.filter((x) => Number(x.id) !== Number(b.id));
  d.copies = d.copies.filter((x) => Number(x.bookId) !== Number(b.id));
  d.reservations = d.reservations.filter((x) => Number(x.bookId) !== Number(b.id));
  save();
  log(u.cardNo, 'book.delete', `删除图书《${b.title}》`);
  return { ok: true };
});

GET('/api/admin/books/:id/copies', ({ params }) => {
  requireRole(STAFF);
  const b = find('books', Number(params.id));
  if (!b) throw new ApiError(404, '图书不存在');
  const copies = table('copies')
    .filter((c) => Number(c.bookId) === Number(b.id))
    .sort((x, y) => String(x.barcode).localeCompare(String(y.barcode)))
    .map((c) => {
      const br = table('borrows').find((x) => Number(x.copyId) === Number(c.id) && x.status === 'borrowed');
      const holder = br ? (find('users', br.userId) || {}) : null;
      return { ...c, dueAt: br ? br.dueAt : null, holder: holder ? holder.name : null };
    });
  return { book: bookCard(b, null), copies };
});

POST('/api/admin/books/:id/copies', ({ params, body }) => {
  const u = requireRole(STAFF);
  const id = Number(params.id);
  const n = Math.max(1, Math.min(50, Number(body.count) || 1));
  addCopies(id, n);
  log(u.cardNo, 'copy.add', `图书 #${id} 增加 ${n} 册`);
  return { ok: true, stock: bookStock(id) };
});

PATCH('/api/admin/copies/:id', ({ params, body }) => {
  const u = requireRole(STAFF);
  if (!['available', 'borrowed', 'reserved', 'lost', 'repair'].includes(body.status)) {
    throw new ApiError(400, '状态不合法');
  }
  return setCopyStatus(Number(params.id), body.status, u.cardNo);
});

DEL('/api/admin/copies/:id', ({ params }) => {
  const u = requireRole(['admin']);
  const copy = find('copies', Number(params.id));
  if (!copy) throw new ApiError(404, '副本不存在');
  if (copy.status === 'borrowed') throw new ApiError(400, '该册在借，不能删除');
  const d = load();
  d.copies = d.copies.filter((x) => Number(x.id) !== Number(copy.id));
  save();
  syncTotal(copy.bookId);
  log(u.cardNo, 'copy.delete', `删除条码 ${copy.barcode}`);
  return { ok: true };
});

/* ---------- 分类 ---------- */
GET('/api/admin/categories', () => {
  requireRole(STAFF);
  return table('categories')
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((c) => ({ ...c, books: table('books').filter((b) => Number(b.categoryId) === Number(c.id)).length }));
});

POST('/api/admin/categories', ({ body }) => {
  const u = requireRole(STAFF);
  if (!body.name) throw new ApiError(400, '分类名必填');
  if (table('categories').some((c) => c.name === body.name)) throw new ApiError(400, '该分类已存在');
  const rec = insert('categories', { name: body.name, code: body.code || null, sort: Number(body.sort) || 99 });
  log(u.cardNo, 'category.create', `新增分类 ${body.name}`);
  return { id: rec.id };
});

PUT('/api/admin/categories/:id', ({ params, body }) => {
  const u = requireRole(STAFF);
  const c = find('categories', Number(params.id));
  if (!c) throw new ApiError(404, '分类不存在');
  if (body.name !== undefined) c.name = body.name;
  if (body.code !== undefined) c.code = body.code;
  if (body.sort !== undefined) c.sort = Number(body.sort);
  save();
  log(u.cardNo, 'category.update', `修改分类 #${c.id}`);
  return { ok: true };
});

DEL('/api/admin/categories/:id', ({ params }) => {
  const u = requireRole(['admin']);
  const id = Number(params.id);
  const n = table('books').filter((b) => Number(b.categoryId) === id).length;
  if (n > 0) throw new ApiError(400, `该分类下还有 ${n} 种图书，不能删除`);
  remove('categories', id);
  log(u.cardNo, 'category.delete', `删除分类 #${id}`);
  return { ok: true };
});

/* ---------- 读者管理 ---------- */
GET('/api/admin/users', ({ query }) => {
  requireRole(STAFF);
  const q = query;
  let rows = table('users').slice().sort((a, b) => a.id - b.id);
  if (q.keyword) {
    const kw = q.keyword.trim();
    rows = rows.filter((u) => like(u.cardNo, kw) || like(u.name, kw) || like(u.dept, kw) || like(u.phone, kw));
  }
  if (q.role) rows = rows.filter((u) => u.role === q.role);
  if (q.status) rows = rows.filter((u) => u.status === q.status);

  return rows.map((u) => ({
    ...publicUser(u),
    active: table('borrows').filter((b) => Number(b.userId) === Number(u.id) && b.status === 'borrowed').length,
    overdue: table('borrows').filter((b) => Number(b.userId) === Number(u.id) && b.status === 'borrowed' && b.dueAt < now()).length,
    reservations: table('reservations').filter((r) => Number(r.userId) === Number(u.id) && ['waiting', 'ready'].includes(r.status)).length,
    history: table('borrows').filter((b) => Number(b.userId) === Number(u.id)).length,
    note: u.note, maxBorrow: u.maxBorrow, lastLogin: u.lastLogin, createdAt: u.createdAt,
  }));
});

POST('/api/admin/users', async ({ body }) => {
  const u = requireRole(STAFF);
  if (!body.cardNo || !body.name) throw new ApiError(400, '借书证号与姓名必填');
  if (table('users').some((x) => x.cardNo === body.cardNo)) throw new ApiError(400, '借书证号已存在');
  const pwd = String(body.password || '123456');
  if (pwd.length < 6) throw new ApiError(400, '初始密码至少 6 位');
  const { hash, salt } = await hashPassword(pwd);
  const rec = insert('users', {
    cardNo: body.cardNo, name: body.name, password: hash, salt,
    role: body.role || 'reader', dept: body.dept || null, phone: body.phone || null,
    status: 'active', maxBorrow: body.maxBorrow ? Number(body.maxBorrow) : null,
    note: body.note || null, createdAt: now(), lastLogin: null,
  });
  log(u.cardNo, 'user.create', `新增读者 ${body.name}(${body.cardNo})`);
  return { id: rec.id };
});

PUT('/api/admin/users/:id', async ({ params, body }) => {
  const u = requireRole(STAFF);
  const target = find('users', Number(params.id));
  if (!target) throw new ApiError(404, '读者不存在');
  if (body.role && body.role !== target.role && u.role !== 'admin') throw new ApiError(403, '只有管理员能改角色');
  if (body.name !== undefined) target.name = body.name;
  if (body.dept !== undefined) target.dept = body.dept;
  if (body.phone !== undefined) target.phone = body.phone;
  if (body.status !== undefined) target.status = body.status;
  if (body.role !== undefined) target.role = body.role;
  if (body.maxBorrow !== undefined) target.maxBorrow = num(body.maxBorrow);
  if (body.note !== undefined) target.note = body.note;
  if (body.password) {
    if (String(body.password).length < 6) throw new ApiError(400, '密码至少 6 位');
    const { hash, salt } = await hashPassword(String(body.password));
    target.password = hash;
    target.salt = salt;
  }
  save();
  log(u.cardNo, 'user.update', `修改读者 ${target.name}(${target.cardNo})`);
  return publicUser(target);
});

DEL('/api/admin/users/:id', ({ params }) => {
  const u = requireRole(['admin']);
  const target = find('users', Number(params.id));
  if (!target) throw new ApiError(404, '读者不存在');
  if (Number(target.id) === Number(u.id)) throw new ApiError(400, '不能删除自己');
  const active = table('borrows').filter(
    (b) => Number(b.userId) === Number(target.id) && b.status === 'borrowed',
  ).length;
  if (active > 0) throw new ApiError(400, '该读者还有在借图书，不能删除');
  const d = load();
  d.users = d.users.filter((x) => Number(x.id) !== Number(target.id));
  d.reservations = d.reservations.filter((x) => Number(x.userId) !== Number(target.id));
  save();
  log(u.cardNo, 'user.delete', `删除读者 ${target.name}(${target.cardNo})`);
  return { ok: true };
});

/* ---------- 借还台 ---------- */
GET('/api/admin/circulation', ({ query }) => {
  requireRole(STAFF);
  sweep();
  const status = query.status || 'borrowed';
  let rows = table('borrows').slice();
  if (status === 'overdue') rows = rows.filter((b) => b.status === 'borrowed' && b.dueAt < now());
  else if (status !== 'all') rows = rows.filter((b) => b.status === status);
  rows.sort((a, b) => (b.status === 'borrowed' ? 1 : 0) - (a.status === 'borrowed' ? 1 : 0)
    || String(a.dueAt).localeCompare(String(b.dueAt)));

  const today = todayStr();
  return {
    items: rows.slice(0, 300).map((r) => {
      const u = find('users', r.userId) || {};
      const b = find('books', r.bookId) || {};
      const cp = find('copies', r.copyId) || {};
      return {
        ...r,
        name: u.name, cardNo: u.cardNo, dept: u.dept,
        title: b.title, author: b.author, barcode: cp.barcode,
        overdueDays: r.status === 'borrowed' ? Math.max(0, Math.ceil((Date.now() - new Date(r.dueAt)) / 864e5)) : 0,
      };
    }),
    stats: {
      borrowed: table('borrows').filter((b) => b.status === 'borrowed').length,
      overdue: table('borrows').filter((b) => b.status === 'borrowed' && b.dueAt < now()).length,
      returnedToday: table('borrows').filter((b) => b.returnedAt && String(b.returnedAt).slice(0, 10) === today).length,
      borrowedToday: table('borrows').filter((b) => String(b.borrowedAt).slice(0, 10) === today).length,
    },
  };
});

POST('/api/admin/circulation/borrow', ({ body }) => {
  const u = requireRole(STAFF);
  let user = null;
  if (body.cardNo) {
    const key = body.cardNo.trim();
    user = table('users').find((x) => x.cardNo === key || x.name === key);
    if (!user) throw new ApiError(404, `没有证号为 ${body.cardNo} 的读者`);
  } else if (body.userId) {
    user = find('users', Number(body.userId));
  }
  if (!user) throw new ApiError(400, '请先选择读者');

  let bid = Number(body.bookId) || null;
  if (body.barcode) {
    const copy = table('copies').find((c) => c.barcode === body.barcode.trim());
    if (!copy) throw new ApiError(404, `没有条码 ${body.barcode} 的馆藏`);
    bid = copy.bookId;
  }
  const r = borrowBook({
    userId: user.id, bookId: bid, copyBarcode: body.barcode?.trim(), operator: u.cardNo,
  });
  const book = find('books', bid);
  return { ...r, userName: user.name, bookTitle: book ? book.title : '' };
});

POST('/api/admin/circulation/return', ({ body }) => {
  const u = requireRole(STAFF);
  return returnBook({
    barcode: body.barcode?.trim(), borrowId: Number(body.borrowId) || null, operator: u.cardNo,
  });
});

POST('/api/admin/circulation/renew', ({ body }) => {
  requireRole(STAFF);
  return renewBorrow({ borrowId: Number(body.borrowId), userId: null });
});

GET('/api/admin/lookup', ({ query }) => {
  requireRole(STAFF);
  const code = String(query.code || '').trim();
  if (!code) return null;

  const user = table('users').find((x) => x.cardNo === code);
  if (user) {
    const active = table('borrows')
      .filter((b) => Number(b.userId) === Number(user.id) && b.status === 'borrowed')
      .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))
      .map((b) => ({ id: b.id, dueAt: b.dueAt, title: (find('books', b.bookId) || {}).title }));
    return {
      type: 'user',
      user: { ...publicUser(user), status: user.status, maxBorrow: user.maxBorrow },
      stats: userBorrowStats(user.id),
      active,
    };
  }
  const copy = table('copies').find((c) => c.barcode === code);
  if (copy) {
    const book = find('books', copy.bookId) || {};
    const borrow = table('borrows').find((b) => Number(b.copyId) === Number(copy.id) && b.status === 'borrowed');
    const bu = borrow ? find('users', borrow.userId) : null;
    return {
      type: 'copy',
      copy: { ...copy, title: book.title, author: book.author },
      borrow: borrow ? { ...borrow, name: bu ? bu.name : null, cardNo: bu ? bu.cardNo : null } : null,
      stock: bookStock(copy.bookId),
    };
  }
  const book = table('books').find((b) => b.isbn === code);
  if (book) {
    return {
      type: 'book',
      book: bookCard(book, null),
      copies: table('copies').filter((c) => Number(c.bookId) === Number(book.id))
        .sort((a, b) => String(a.barcode).localeCompare(String(b.barcode))),
    };
  }
  return null;
});

/* ---------- 预约管理 ---------- */
GET('/api/admin/reservations', ({ query }) => {
  requireRole(STAFF);
  sweep();
  const status = query.status || 'active';
  let rows = table('reservations').slice();
  if (status === 'active') rows = rows.filter((r) => ['waiting', 'ready'].includes(r.status));
  else if (status !== 'all') rows = rows.filter((r) => r.status === status);
  rows.sort((a, b) => (b.status === 'ready' ? 1 : 0) - (a.status === 'ready' ? 1 : 0)
    || a.queueNo - b.queueNo || String(a.createdAt).localeCompare(String(b.createdAt)));
  return rows.map((r) => {
    const u = find('users', r.userId) || {};
    const b = find('books', r.bookId) || {};
    return { ...r, name: u.name, cardNo: u.cardNo, title: b.title, author: b.author };
  });
});

POST('/api/admin/reservations/:id/cancel', ({ params }) => {
  requireRole(STAFF);
  return cancelReservation({ id: Number(params.id), byStaff: true });
});

POST('/api/admin/reservations/:id/ready', ({ params }) => {
  const u = requireRole(STAFF);
  const r = find('reservations', Number(params.id));
  if (!r) throw new ApiError(404, '预约不存在');
  if (r.status !== 'waiting') throw new ApiError(400, '该预约不在排队状态');
  const copy = table('copies')
    .filter((c) => Number(c.bookId) === Number(r.bookId) && c.status === 'available')
    .sort((a, b) => a.id - b.id)[0];
  if (!copy) throw new ApiError(400, '该书当前没有可分配的在架副本');
  const rules = getRules();
  copy.status = 'reserved';
  r.status = 'ready';
  r.readyAt = now();
  r.expireAt = new Date(Date.now() + (rules.reserveHoldDays || 3) * 864e5).toISOString();
  save();
  log(u.cardNo, 'reservation.ready', `预约 #${r.id} 手动置为到书`);
  return { ok: true };
});

POST('/api/admin/reservations/:id/fulfill', ({ params }) => {
  const u = requireRole(STAFF);
  const r = find('reservations', Number(params.id));
  if (!r) throw new ApiError(404, '预约不存在');
  return borrowBook({ userId: r.userId, bookId: r.bookId, operator: u.cardNo });
});

/* ---------- 公告 ---------- */
GET('/api/admin/notices', () => {
  requireRole(STAFF);
  return table('notices')
    .slice()
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
});

POST('/api/admin/notices', ({ body }) => {
  const u = requireRole(STAFF);
  if (!body.title || !body.body) throw new ApiError(400, '标题与正文必填');
  const rec = insert('notices', {
    title: body.title, body: body.body, pinned: body.pinned ? 1 : 0,
    createdAt: now(), author: u.name,
  });
  log(u.cardNo, 'notice.create', `发布公告《${body.title}》`);
  return { id: rec.id };
});

PUT('/api/admin/notices/:id', ({ params, body }) => {
  const u = requireRole(STAFF);
  const n = find('notices', Number(params.id));
  if (!n) throw new ApiError(404, '公告不存在');
  if (body.title !== undefined) n.title = body.title;
  if (body.body !== undefined) n.body = body.body;
  if (body.pinned !== undefined) n.pinned = body.pinned ? 1 : 0;
  save();
  log(u.cardNo, 'notice.update', `修改公告 #${n.id}`);
  return { ok: true };
});

DEL('/api/admin/notices/:id', ({ params }) => {
  const u = requireRole(STAFF);
  remove('notices', Number(params.id));
  log(u.cardNo, 'notice.delete', `删除公告 #${params.id}`);
  return { ok: true };
});

/* ---------- 设置与日志 ---------- */
GET('/api/admin/settings', () => {
  requireRole(STAFF);
  const s = load();
  return {
    siteName: getSetting('siteName'), siteSub: getSetting('siteSub'),
    noticeBar: getSetting('noticeBar'), rules: getRules(),
    dbFile: '浏览器 localStorage（qingteng.library.db.v1）',
    counts: {
      books: s.books.length, copies: s.copies.length, borrows: s.borrows.length,
      reservations: s.reservations.length, users: s.users.length, logs: s.logs.length,
    },
  };
});

PUT('/api/admin/settings', ({ body }) => {
  const u = requireRole(['admin']);
  for (const k of ['siteName', 'siteSub', 'noticeBar']) {
    if (body[k] !== undefined) setSetting(k, body[k]);
  }
  if (body.rules) {
    const rules = body.rules;
    const clean = {};
    for (const k of ['borrowDays', 'maxBorrow', 'maxReserve', 'renewTimes', 'renewDays', 'reserveHoldDays']) {
      if (rules[k] !== undefined) clean[k] = Math.max(0, Number(rules[k]) || 0);
    }
    if (rules.finePerDay !== undefined) clean.finePerDay = Math.max(0, Number(rules.finePerDay) || 0);
    if (rules.openHours !== undefined) clean.openHours = String(rules.openHours);
    saveRules(clean);
  }
  log(u.cardNo, 'settings.update', '修改系统设置');
  return { ok: true, rules: getRules() };
});

GET('/api/admin/logs', ({ query }) => {
  requireRole(STAFF);
  const page = Math.max(1, Number(query.page) || 1);
  const size = 30;
  const all = table('logs').slice().sort((a, b) => b.id - a.id);
  return {
    total: all.length, page, pages: Math.ceil(all.length / size) || 1,
    items: all.slice((page - 1) * size, page * size),
  };
});

/** 导出：与后端版同列，改为浏览器内生成 CSV */
GET('/api/admin/export', ({ query }) => {
  requireRole(STAFF);
  const type = query.type || 'borrows';
  if (type === 'books') {
    const rows = table('books').slice().sort((a, b) => a.id - b.id).map((b) => ({
      id: b.id, isbn: b.isbn, title: b.title, author: b.author, publisher: b.publisher,
      pub_year: b.pubYear, category: categoryName(b.categoryId), price: b.price,
      location: b.location, total_copies: b.totalCopies,
    }));
    return { csv: toCsv(rows), filename: '图书台账.csv' };
  }
  if (type === 'readers') {
    const rows = table('users').slice().sort((a, b) => a.id - b.id).map((u) => ({
      card_no: u.cardNo, name: u.name, role: u.role, dept: u.dept, phone: u.phone, status: u.status,
      active: table('borrows').filter((b) => Number(b.userId) === Number(u.id) && b.status === 'borrowed').length,
    }));
    return { csv: toCsv(rows), filename: '读者名册.csv' };
  }
  const rows = table('borrows').slice().sort((a, b) => b.id - a.id).map((br) => {
    const u = find('users', br.userId) || {};
    const b = find('books', br.bookId) || {};
    const cp = find('copies', br.copyId) || {};
    return {
      id: br.id, card_no: u.cardNo, name: u.name, dept: u.dept, title: b.title, author: b.author,
      barcode: cp.barcode, borrowed_at: br.borrowedAt, due_at: br.dueAt, returned_at: br.returnedAt,
      renew_count: br.renewCount, status: br.status, operator: br.operator,
    };
  });
  return { csv: toCsv(rows), filename: '借阅流水.csv' };
});

/* 重置演示数据（纯静态版专有） */
POST('/api/admin/reset-demo', () => {
  requireRole(['admin']);
  resetDb();
  return { ok: true };
});

/* ============================ 分发 ============================ */

function parseQuery(search) {
  const out = {};
  for (const [k, v] of search.entries()) out[k] = v;
  return out;
}

/**
 * 本地接口分发：签名与 fetch 版一致，返回 {data} 或 {csv,filename}
 * path 可带查询串，如 '/api/books?page=2&keyword=python'
 */
export async function dispatch(path, { method = 'GET', body } = {}) {
  const [pathname, search = ''] = String(path).split('?');
  const query = parseQuery(new URLSearchParams(search));

  for (const r of routes) {
    const m = r.re.exec(pathname);
    if (!m || r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const out = await r.handler({ params, query, body: body || {} });
    return out;
  }
  throw new ApiError(404, `本地接口不存在：${method} ${pathname}`);
}
