/* ════════════════════════════════════════════════════════════
   store.js — 本地存储与分享链接（纯逻辑，无 DOM，可在 Node 中测试）

   历史记录与收藏都存 localStorage，不上传服务器。
   分享走 URL hash：把身体数据编码进链接，别人打开即可复现同一份分析。
   ════════════════════════════════════════════════════════════ */

export const KEYS = {
  history: 'fnt.history.v1',
  favorites: 'fnt.favorites.v1',
  last: 'fnt.lastProfile.v1'
};

export const LIMITS = { history: 20, favorites: 60 };

/* ── 存储适配层 ──
   浏览器用 localStorage；Node 测试时注入内存实现，
   这样 store.js 无需 DOM 也能被测试覆盖。 */
let backend = (() => {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (_) { /* 隐私模式下访问会抛错 */ }
  return null;
})();

const memory = new Map();
const memBackend = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k)
};

export function setBackend(b) { backend = b; }
export function usingMemory() { return backend === null || backend === memBackend; }

function getBackend() { return backend || memBackend; }

function read(key, fallback) {
  try {
    const raw = getBackend().getItem(key);
    if (!raw) return fallback;
    const val = JSON.parse(raw);
    return val == null ? fallback : val;
  } catch (_) {
    return fallback;      // 数据损坏时退回默认值，不让页面崩掉
  }
}

function write(key, value) {
  try {
    getBackend().setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;         // 配额满或隐私模式
  }
}

/* ── 只保留可复现分析所需的字段，避免把整份推荐结果塞进 localStorage ──
   每条给一个唯一 id：时间戳在同一毫秒内可能重复，
   若用 ts 当删除依据，会连带删掉同毫秒的另一条。 */
let seq = 0;
function makeId() {
  seq += 1;
  return Date.now().toString(36) + '-' + seq.toString(36) + '-' +
         Math.random().toString(36).slice(2, 7);
}

export function compactEntry(profile, goal, form) {
  return {
    id: makeId(),
    ts: Date.now(),
    goal,
    sex: form.sex,
    height: form.height,
    weight: form.weight,
    age: form.age,
    activity: form.activity,
    bmi: Math.round(profile.bmi * 10) / 10,
    bmiTag: profile.bmiTag,
    kcal: Math.round(profile.targetKcal),
    protein: Math.round(profile.proteinTarget)
  };
}

/* ── 历史记录 ── */
export function getHistory() {
  const h = read(KEYS.history, []);
  return Array.isArray(h) ? h : [];
}

export function addHistory(entry) {
  const list = getHistory().filter(e =>
    !(e.height === entry.height && e.weight === entry.weight && e.age === entry.age &&
      e.sex === entry.sex && e.goal === entry.goal && e.activity === entry.activity));
  list.unshift(entry);                       // 同参数的旧记录去掉，只留最新一次
  const trimmed = list.slice(0, LIMITS.history);
  write(KEYS.history, trimmed);
  return trimmed;
}

export function removeHistory(id) {
  const list = getHistory().filter(e => e.id !== id);
  write(KEYS.history, list);
  return list;
}

export function clearHistory() {
  write(KEYS.history, []);
  return [];
}

/* 最近一次的分析参数：下次打开自动回填表单 */
export function saveLastProfile(form) { write(KEYS.last, form); }
export function getLastProfile() { return read(KEYS.last, null); }

/* ── 收藏（按食物编码） ── */
export function getFavorites() {
  const f = read(KEYS.favorites, []);
  return Array.isArray(f) ? f : [];
}

export function isFavorite(code) {
  return getFavorites().some(x => x.code === code);
}

export function toggleFavorite(code, name) {
  const list = getFavorites();
  const i = list.findIndex(x => x.code === code);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ code, name, ts: Date.now() });
  const trimmed = list.slice(0, LIMITS.favorites);
  write(KEYS.favorites, trimmed);
  return { list: trimmed, added: i < 0 };
}

export function clearFavorites() {
  write(KEYS.favorites, []);
  return [];
}

/* ════════════ 分享链接 ════════════
   把身体数据编码进 URL hash。用 base64 避免中文/特殊字符问题，
   并兼容 URL 安全字符集。 */
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(str, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - b64.length % 4) % 4);
  if (typeof atob === 'function') {
    const bin = atob(pad);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(pad, 'base64').toString('utf-8');
}

/* 只放必要的几个数，链接尽量短 */
export function encodeShare(form) {
  const payload = {
    s: form.sex === 'female' ? 'f' : 'm',
    h: form.height, w: form.weight, a: form.age,
    c: form.activity, g: form.goal
  };
  return b64encode(JSON.stringify(payload));
}

export function decodeShare(token) {
  try {
    const p = JSON.parse(b64decode(token));
    const height = Number(p.h), weight = Number(p.w), age = Number(p.a);
    const activity = Number(p.c);
    const sex = p.s === 'f' ? 'female' : 'male';
    const goal = p.g === 'bulk' ? 'bulk' : 'cut';
    if (!(height >= 120 && height <= 230)) return null;
    if (!(weight >= 25 && weight <= 250)) return null;
    if (!(age >= 18 && age <= 100)) return null;
    if (!(activity >= 1.1 && activity <= 2.0)) return null;
    return { sex, height, weight, age, activity, goal };
  } catch (_) {
    return null;           // 链接被截断或篡改时静默忽略
  }
}

/* 从 location.hash 读取分享参数；无 hash 返回 null */
export function readShareFromHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h.startsWith('p=')) return null;
  return decodeShare(h.slice(2));
}

export function buildShareUrl(origin, pathname, form) {
  return `${origin}${pathname}#p=${encodeShare(form)}`;
}
