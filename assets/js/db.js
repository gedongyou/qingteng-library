/* 浏览器内数据层：单一 localStorage 键持久化 + 首启种子数据
   —— 全站只用一个键 KEY，业务数据与登录状态都放在这一份快照里 */
import { SEED } from './seed-data.js';

const KEY = 'qingteng.library.db.v1';
// 旧版本单独存登录状态用的键，读到就并进主快照并删除
const LEGACY_SESSION_KEY = 'qingteng.library.session.v1';

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
  db.session = null;
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
        if (!('session' in parsed)) parsed.session = null;
        db = parsed;
        migrateLegacySession();
        return db;
      }
    }
  } catch (err) {
    console.warn('本地数据读取失败，将重新初始化：', err);
  }
  db = freshDb();
  migrateLegacySession();
  save();
  return db;
}

/** 把旧版单独存放的登录状态并进主快照，随后删掉旧键 */
function migrateLegacySession() {
  try {
    const legacy = localStorage.getItem(LEGACY_SESSION_KEY);
    if (legacy) {
      if (!db.session) {
        const s = JSON.parse(legacy);
        if (s && s.userId && !(s.expiresAt && new Date(s.expiresAt) < new Date())) {
          db.session = s;
          save();
        }
      }
      localStorage.removeItem(LEGACY_SESSION_KEY);
    }
  } catch { /* 忽略 */ }
}

let saveTimer = null;
export function save() {
  if (!db) return;
  clearTimeout(saveTimer);
  // 略微延迟合并连续写入，避免每次改动都序列化整库
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

/** 恢复出厂演示数据（登录状态一并清空） */
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

/* ---------------- 会话（存在主快照的 session 字段里） ---------------- */
export function getSession() {
  try {
    const d = load();
    const s = d.session;
    if (!s || !s.userId) return null;
    if (s.expiresAt && new Date(s.expiresAt) < new Date()) {
      d.session = null;
      save();
      return null;
    }
    return s;
  } catch { return null; }
}

export function setSession(userId, days = 7) {
  const d = load();
  d.session = {
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + days * 864e5).toISOString(),
  };
  // 登录态立即落盘，避免刷新或关标签页时丢登录
  flush();
  return d.session;
}

export function clearSession() {
  const d = load();
  if (d.session) {
    d.session = null;
    flush();
  }
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
