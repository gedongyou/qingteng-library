/* 浏览器内数据层：localStorage 持久化 + 首启种子数据
   —— 没有后端、没有网络请求，所有表都是内存里的数组，改完立刻写回 localStorage */
import { SEED } from './seed-data.js';

const KEY = 'qingteng.library.db.v1';
const SESSION_KEY = 'qingteng.library.session.v1';

export const clone = (v) => JSON.parse(JSON.stringify(v));

/** 由种子数据生成一份全新的数据库副本 */
function freshDb() {
  const db = clone(SEED);
  db.meta = { version: 1, createdAt: new Date().toISOString(), seq: {} };
  // 每张表的自增游标
  for (const [name, rows] of Object.entries(db)) {
    if (!Array.isArray(rows)) continue;
    db.meta.seq[name] = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  }
  return db;
}

let db = null;

export function load() {
  if (db) return db;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.books && parsed.copies) {
        if (!parsed.meta) parsed.meta = { version: 1, seq: {} };
        db = parsed;
        return db;
      }
    }
  } catch (err) {
    console.warn('本地数据读取失败，将重新初始化：', err);
  }
  db = freshDb();
  save();
  return db;
}

let saveTimer = null;
export function save() {
  if (!db) return;
  clearTimeout(saveTimer);
  // 略微延迟合并连续写入，避免每次 setState 都序列化整库
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (err) {
      console.error('本地数据保存失败（可能是浏览器存储已满）：', err);
    }
  }, 0);
}

export function flush() {
  if (!db) return;
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (err) { console.error(err); }
}

/** 恢复出厂演示数据 */
export function resetDb() {
  db = freshDb();
  flush();
  return db;
}

/** 自增 id */
export function nextId(table) {
  const d = load();
  d.meta.seq[table] = (d.meta.seq[table] || 0) + 1;
  return d.meta.seq[table];
}

/* ---------------- 会话（纯前端，存在 localStorage） ---------------- */
export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.userId) return null;
    if (s.expiresAt && new Date(s.expiresAt) < new Date()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch { return null; }
}

export function setSession(userId, days = 7) {
  const s = {
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + days * 864e5).toISOString(),
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* 忽略 */ }
  return s;
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* 忽略 */ }
}

/* ---------------- 便捷查询 ---------------- */
export const table = (name) => load()[name] || [];
export const find = (name, id) => table(name).find((r) => Number(r.id) === Number(id)) || null;
export const insert = (name, row) => {
  const d = load();
  const id = row.id ?? nextId(name);
  const rec = { ...row, id };
  d[name].push(rec);
  save();
  return rec;
};
export const remove = (name, id) => {
  const d = load();
  d[name] = d[name].filter((r) => Number(r.id) !== Number(id));
  save();
};
