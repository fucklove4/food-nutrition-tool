/* ════════════════════════════════════════════════════════════
   app.js — 界面层
   计算逻辑全部来自 rules.js（同一份代码在 Node 里做过验证）
   链路：输入身体数据 → BMI / 热量·蛋白目标 → 推荐食材
   数据：data/foods.json（每 100 g 可食部）
   ════════════════════════════════════════════════════════════ */
import {
  TH, SERVING, foodType, derive, score, isProteinSource,
  isVeg, isFruit, isStaple, recommend, computeProfile, GROUPS, groupKeyOf,
  searchFoods, searchFacets
} from './rules.js';
import { buildDayPlan } from './planner.js';
import {
  getHistory, addHistory, removeHistory, clearHistory,
  getFavorites, isFavorite, toggleFavorite, clearFavorites,
  compactEntry, saveLastProfile, getLastProfile,
  readShareFromHash, buildShareUrl
} from './store.js';

const state = {
  foods: [], sex: 'male', goal: 'cut', activity: 1.55,
  profile: null, buckets: null, tab: 'veg', expanded: false,
  collapsed: new Set()        // 已折叠的分栏，键为 "tab:section"
};

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d).replace(/\.0+$/, ''));
/* ── AI 调用 ──
   部署后把 PROD_API 改成你的后端地址（如 Render 给的 https://xxx.onrender.com），
   本地访问时自动走 localhost，无需改代码来回切换。 */
const PROD_API = '';   // ← 部署后填，例如 'https://food-nutrition-api.onrender.com'

function apiBase() {
  const host = location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || host === '[::1]';
  if (isLocal) return 'http://127.0.0.1:8000';
  return PROD_API || '';      // 未配置时返回空串，下面会给出明确提示
}

const AI_URL = () => apiBase() + '/api/analyze';

async function getAIAdvice(prompt) {
  if (!apiBase()) {
    throw new Error('未配置后端地址（部署后请在 js/app.js 里填写 PROD_API）');
  }
  const res = await fetch(AI_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '（AI 未返回内容）';
}
/* ── 营养素供能比参考区间 ──
   依据《中国居民膳食指南》的宏量营养素可接受范围（AMDR）：
   碳水 50–65%、脂肪 20–30%、蛋白 10–20%。
   进度条以「占总热量百分比」为尺度，并标出该区间，方便一眼看出是否偏离。 */
const MACRO_DEFS = [
  { key: 'cho', name: '碳水', color: '#d95f5f', kcalPerG: 4, range: [50, 65] },
  { key: 'protein', name: '蛋白质', color: '#7c5cd6', kcalPerG: 4, range: [10, 20] },
  { key: 'fat', name: '脂肪', color: '#e08a3c', kcalPerG: 9, range: [20, 30] }
];

/* 进度条满刻度取 70%：三个区间的上限（65/20/30）都落在可视范围内 */
const BAR_SCALE = 70;

/* ── BMI 色带：中国成人标准 ── */
const BMI_ZONES = [
  { to: 18.5, cls: 's1' },
  { to: 24, cls: 's2' },
  { to: 28, cls: 's3' },
  { to: 32, cls: 's4' },
  { to: 40, cls: 's5' }
];
const BMI_MIN = 15, BMI_MAX = 40;

function bmiPinPercent(bmi) {
  const v = Math.min(Math.max(bmi, BMI_MIN), BMI_MAX);
  return (v - BMI_MIN) / (BMI_MAX - BMI_MIN) * 100;
}

function buildBmiScale(bmi) {
  /* 分段宽度按 BMI 跨度占比，而不是等分 —— 这样标记位置才有意义 */
  let prev = BMI_MIN;
  const segs = BMI_ZONES.map(z => {
    const w = (z.to - prev) / (BMI_MAX - BMI_MIN) * 100;
    prev = z.to;
    return `<div class="scale-seg ${z.cls}" style="width:${w.toFixed(3)}%"></div>`;
  }).join('');

  const marks = [BMI_MIN, 18.5, 24, 28, 32, 40].map((v, i, arr) => {
    const left = i === 0 ? 0 : (arr[i - 1] + v) / 2;   // 中心点，视觉上更均衡
    let c = 0;
    for (let k = 0; k < i; k++) c += (arr[k + 1] - arr[k]) / (BMI_MAX - BMI_MIN) * 100;
    c += (v - (i === 0 ? BMI_MIN : arr[i - 1])) / (BMI_MAX - BMI_MIN) * 100 / 2;
    return `<span style="width:${
      ((i === arr.length - 1 ? BMI_MAX : arr[i + 1]) - v) / (BMI_MAX - BMI_MIN) * 100
    }%">${v}</span>`;
  }).join('');

  return `<div class="scale-bar">${segs}</div>
    <div class="scale-marks">${marks}</div>
    <div class="scale-pin" style="left:${bmiPinPercent(bmi).toFixed(2)}%"></div>`;
}

/* ── 摘要卡 ──
   主视图只给「结论」：热量主视觉 + 营养素分配 + BMI 色带。
   推导过程放进折叠区，数字来源仍可追溯。 */
function renderSummary(p) {
  /* 1) 热量主视觉 */
  $('kcalBig').textContent = Math.round(p.targetKcal);
  const facts = currentForm();
  $('bodyFacts').innerHTML =
    `${facts.goal === 'cut' ? '减脂' : '增肌'} · ${facts.sex === 'male' ? '男' : '女'}<br>` +
    `<b>${facts.weight}</b> 公斤 / <b>${facts.height}</b> 厘米 / <b>${facts.age}</b> 岁`;

  /* 2) 营养素分配进度条 */
  const total = p.targetKcal;
  $('macroBars').innerHTML = MACRO_DEFS.map(d => {
    const grams = d.key === 'cho' ? p.carbG : d.key === 'protein' ? p.proteinTarget : p.fatG;
    const kcal = grams * d.kcalPerG;
    const pct = kcal / total * 100;
    const inRange = pct >= d.range[0] && pct <= d.range[1];
    const fillW = Math.min(pct / BAR_SCALE * 100, 100);
    const rL = d.range[0] / BAR_SCALE * 100;
    const rW = (d.range[1] - d.range[0]) / BAR_SCALE * 100;
    return `<div class="mb">
      <div class="mb-head">
        <span class="mb-name">${d.name}</span>
        <span class="mb-kcal">${Math.round(kcal)} 千卡 · 占 ${pct.toFixed(1)}%</span>
      </div>
      <div class="mb-value">${Math.round(grams)}<i>克</i></div>
      <div class="mb-track">
        <div class="mb-range" style="left:${rL.toFixed(2)}%;width:${rW.toFixed(2)}%"></div>
        <div class="mb-fill" style="width:${fillW.toFixed(2)}%;background:${d.color}"></div>
      </div>
      <div class="mb-foot">
        <span>参考区间 ${d.range[0]}–${d.range[1]}%</span>
        <span class="${inRange ? 'in-range' : 'out-range'}">${inRange ? '在区间内' : '偏离区间'}</span>
      </div>
    </div>`;
  }).join('');

  /* 3) BMI 色带 */
  $('bmiVal').textContent = p.bmi.toFixed(1);
  const tag = $('bmiTag');
  tag.textContent = p.bmiTag;
  tag.className = 'bmi-tag' + (p.bmiClass === 'normal' ? '' : ' warn');
  $('bmiAdvice').textContent = p.bmiAdvice;
  $('bmiScale').innerHTML = buildBmiScale(p.bmi);

  /* 4) 推导过程（折叠区） */
  $('calcDetail').innerHTML =
    `<li>基础代谢（Mifflin-St Jeor）：男 = 10×体重 + 6.25×身高 − 5×年龄 + 5；女 = 同式 − 161
         → 你的基础代谢 <b>${Math.round(p.bmr)} kcal</b></li>
     <li>每日消耗 = 基础代谢 × 活动系数 → 你的每日消耗 <b>${Math.round(p.tdee)} kcal</b></li>
     <li>目标热量 = 每日消耗 × ${p.goalFactor} → <b>${Math.round(p.targetKcal)} kcal</b>
         ${p.kcalNote}</li>
     <li>蛋白质 = ${p.proteinPerKg} g/kg × 体重 → <b>${Math.round(p.proteinTarget)} g</b>；
         碳水与脂肪由「剩余热量」分配</li>
     <li>由此得到的实际供能比：${p.splitLabel}
         （营养素进度条即按此比例绘制）</li>`;
}

/* ── 食物卡 ── */
function foodCard(f) {
  const srv = SERVING[f.type] || 100;
  const perServing = f.kcal != null ? Math.round(f.kcal * srv / 100) : null;

  const stats = [
    `<span class="kc">${fmt(f.kcal)} kcal</span>`,
    `<span>蛋白 <b>${fmt(f.protein, 1)}</b>g</span>`,
    `<span>脂肪 <b>${fmt(f.fat, 1)}</b>g</span>`,
    `<span>碳水 <b>${fmt(f.cho, 1)}</b>g</span>`
  ];
  if (f.fiber != null) stats.push(`<span>纤维 <b>${fmt(f.fiber, 1)}</b>g</span>`);
  if (f.na != null) stats.push(`<span>钠 <b>${fmt(f.na)}</b>mg</span>`);
  if (f.chol != null && f.chol > 0) stats.push(`<span>胆固醇 <b>${fmt(f.chol)}</b>mg</span>`);

  const pills = [
    ...f.pros.slice(0, 5).map(t => `<span class="pill good">${t}</span>`),
    ...f.warns.map(t => `<span class="pill warn">${t}</span>`)
  ].join('');

  const noteHtml = f.notes.length
    ? `<p class="why-note">${f.notes.map(n => '· ' + n).join('<br>')}</p>` : '';
  const srvNote = perServing != null
    ? `<span class="match">参考份量 ${srv}g ≈ ${perServing} kcal</span>` : '';

  return `<article class="food">
    <div class="food-head">
      <span class="food-name">${f.name}</span>
      <span class="food-cat">${f.cat}${f.sub && f.sub !== f.cat ? ' · ' + f.sub : ''}</span>
      ${favButton(f.code, f.name)}
    </div>
    <div class="food-stats">${stats.join('')}</div>
    <div class="pills">${pills}</div>
    ${noteHtml}
    <p class="why-note">${srvNote} · 每 100 g 可食部（食部 ${fmt(f.edible)}%）</p>
  </article>`;
}

const TABS = [
  { key: 'protein', label: '优质蛋白' },
  { key: 'veg', label: '蔬菜菌藻' },
  { key: 'fruit', label: '水果' },
  { key: 'staple', label: '主食薯类' }
];

/* 按功能/部位分栏渲染（蛋白按来源，蔬菜按部位，水果按类别，主食按谷物）。
   每个分栏可折叠：折叠状态存在 state.collapsed（键为 tab:section），
   这样切换标签页或重新渲染时折叠状态不会丢。 */
/* 奶类条目高度相似（各种牛奶/奶粉），单独限流以免刷屏 */
const SLOT_LIMIT = { dairy: 4 };

const secKey = (tab, k) => `${tab}:${k}`;
const isCollapsed = (tab, k) => state.collapsed.has(secKey(tab, k));

function renderSections(list, tab, perSection) {
  const defs = GROUPS[tab] || [];
  const groups = {};
  for (const f of list) {
    const k = groupKeyOf(f, tab);
    (groups[k] ||= []).push(f);
  }

  const keys = defs.map(d => d.key).filter(k => groups[k] && groups[k].length);
  const extra = Object.keys(groups).filter(k => !defs.some(d => d.key === k));
  const labelOf = (k) => (defs.find(d => d.key === k) || {}).label || '其他';

  return [...keys, ...extra].map(k => {
    const collapsed = isCollapsed(tab, k);
    const cap = state.expanded ? 999 : Math.min(perSection, SLOT_LIMIT[k] || perSection);
    const items = groups[k].slice(0, cap);
    const more = groups[k].length - items.length;

    const head = `<button type="button" class="sect-toggle${collapsed ? ' collapsed' : ''}"
        data-sec="${escapeHtml(secKey(tab, k))}" aria-expanded="${!collapsed}">
        <span class="st-left">
          <span class="chev">▼</span>
          <span>${labelOf(k)}</span>
        </span>
        <span class="st-count">${groups[k].length} 种${collapsed ? '' : ''}</span>
      </button>`;

    /* 折叠时只留标题，连卡片 DOM 都不生成，长列表滚动更轻快 */
    if (collapsed) return head;

    const body = `<div class="sect-body">${items.map(foodCard).join('')}
      ${more > 0 ? `<p class="small muted" style="margin:2px 0 0">还有 ${more} 种，见下方「显示全部」</p>` : ''}
    </div>`;
    return head + body;
  }).join('');
}

function renderRecs() {
  const b = state.buckets, goal = state.goal;

  /* 减脂先看蔬菜，增肌先看主食；蛋白始终第一 */
  const order = [...TABS].sort((x, y) => {
    const rank = (k) => {
      if (k === 'protein') return 0;
      if (goal === 'cut') return k === 'veg' ? 1 : k === 'fruit' ? 2 : 3;
      return k === 'staple' ? 1 : k === 'fruit' ? 2 : 3;
    };
    return rank(x.key) - rank(y.key);
  });

  $('tabs').innerHTML = order.map(t =>
    `<button type="button" class="tab${t.key === state.tab ? ' active' : ''}" data-tab="${t.key}">
       ${t.label} <span class="cnt">${(b[t.key] || []).length}</span></button>`).join('');

  const list = b[state.tab] || [];
  const perSection = state.expanded ? 999 : 6;
  $('recList').innerHTML = list.length
    ? renderSections(list, state.tab, perSection)
    : '<p class="muted small">该类别暂无可推荐食物。</p>';

  const btn = $('more');
  const shownDefault = perSection * (GROUPS[state.tab] || []).length;
  if (list.length > shownDefault) {
    btn.classList.remove('hidden');
    btn.textContent = state.expanded ? '收起' : `显示全部 ${list.length} 种`;
  } else btn.classList.add('hidden');
}

/* ════════════ 食物搜索 ════════════
   搜索结果是原始记录（没有预计算的 pros/warns），
   这里补上与推荐卡一致的推导结果，保证两种卡片信息一致。 */
function enrich(food) {
  const e = Object.assign({}, food, { type: foodType(food) });
  const d = derive(e);
  e.pros = d.pros; e.warns = d.warns; e.notes = d.notes;
  return e;
}

const SEARCH_LIMIT = 30;   // 默认最多渲染多少张卡，避免一次插入上千个 DOM

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSearch() {
  const q = $('searchInput').value;
  const meta = $('searchMeta');
  const box = $('searchResults');

  if (!q.trim()) {
    meta.textContent = '';
    box.innerHTML = '';
    return;
  }

  const r = searchFoods(state.foods, q, { limit: 999 });
  if (!r.total) {
    meta.textContent = '';
    box.innerHTML = `<p class="search-empty">没有找到「${escapeHtml(q)}」<br>
      试试更短的词，或用拼音首字母（如 jxpr = 鸡胸脯肉）</p>`;
    return;
  }

  const shown = r.foods.slice(0, SEARCH_LIMIT);
  meta.textContent = `找到 ${r.total} 种食物` +
    (r.total > SEARCH_LIMIT ? `，显示前 ${SEARCH_LIMIT} 种` : '');

  let html = '';
  if (r.total > 8) {
    const facets = searchFacets(r.foods).slice(0, 6)
      .map(([c, n]) => `${c} ${n}`).join(' · ');
    html += `<p class="small muted" style="margin:0 0 10px">${facets}</p>`;
  }
  html += shown.map(f => foodCard(enrich(f))).join('');
  box.innerHTML = html;
}

/* ════════════ 功能总览 ════════════
   作品集里第一眼要能看清"这工具能做什么"，
   所以把六项能力做成可点击的概览，点了直接跳到对应功能区。 */
const FEATURES = [
  { icon: '📊', title: '营养画像', desc: 'BMI、每日热量与三大营养素目标', target: 'summaryCard', needsInput: true },
  { icon: '🍽', title: '食材推荐', desc: '按目标推荐，含优缺点与注意', target: 'recCard', needsInput: true },
  { icon: '📅', title: '一日三餐', desc: '三餐 + 加餐，精确到克数', target: 'mealCard', needsInput: true },
  { icon: '🔍', title: '食物搜索', desc: '1,677 种食物，支持拼音首字母', target: 'searchCard' },
  { icon: '⭐', title: '收藏与历史', desc: '本地保存，可分享分析链接', target: 'historyCard' },
  { icon: '🤖', title: 'AI 建议', desc: '营养师视角的个性化点评', target: 'summaryCard', needsInput: true, ai: true }
];

function renderFeatures() {
  const ready = !!state.profile;
  $('featGrid').innerHTML = FEATURES.map((f, i) => {
    const pending = f.needsInput && !ready;
    return `<button type="button" class="feat${pending ? ' needs-input' : ''}"
        data-goto="${f.target}" data-feat="${i}">
        <span class="feat-ico">${f.icon}</span>
        <span class="feat-txt">
          <b>${f.title}</b>
          <span>${pending ? '填好身体数据后可用' : f.desc}</span>
        </span>
      </button>`;
  }).join('');
}

/* 滚动到目标区域并短暂高亮，让用户知道跳到了哪里 */
function jumpTo(id) {
  const el = $(id);
  if (!el || el.classList.contains('hidden')) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('flash');
  void el.offsetWidth;              // 重启动画
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1000);
  return true;
}

/* ════════════ 收藏 / 历史 / 分享 ════════════ */
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function favButton(code, name) {
  const on = isFavorite(code);
  return `<button type="button" class="fav-btn${on ? ' on' : ''}"
    data-fav="${escapeHtml(code)}" data-name="${escapeHtml(name)}"
    title="${on ? '取消收藏' : '加入收藏'}"
    aria-label="${on ? '取消收藏' : '加入收藏'}">${on ? '★' : '☆'}</button>`;
}

function renderFavorites() {
  const list = getFavorites();
  const card = $('favCard');
  if (!list.length) { card.classList.add('hidden'); return; }

  const byCode = new Map(state.foods.map(f => [f.code, f]));
  const html = list
    .map(x => byCode.get(x.code))
    .filter(Boolean)
    .map(f => `<article class="food">
        <div class="food-head">
          <span class="food-name">${escapeHtml(f.name)}</span>
          <span class="food-cat">${f.cat}</span>
          ${favButton(f.code, f.name)}
        </div>
        <div class="food-stats">
          <span class="kc">${fmt(f.kcal)} kcal</span>
          <span>蛋白 <b>${fmt(f.protein, 1)}</b>g</span>
          <span>脂肪 <b>${fmt(f.fat, 1)}</b>g</span>
          <span>碳水 <b>${fmt(f.cho, 1)}</b>g</span>
        </div>
        <p class="why-note"><span class="match">每 100 g 可食部</span></p>
      </article>`).join('');

  $('favList').innerHTML = html;
  card.classList.remove('hidden');
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderHistory() {
  const list = getHistory();
  const card = $('historyCard');
  if (!list.length) { card.classList.add('hidden'); return; }

  $('historyList').innerHTML = list.map(e => `
    <div class="mini-item" data-restore="${escapeHtml(e.id)}">
      <div class="mi-main">
        <div class="mi-title">${e.bmi} ${escapeHtml(e.bmiTag)} ·
          ${e.goal === 'cut' ? '减脂' : '增肌'}</div>
        <div class="mi-sub">${e.height}cm · ${e.weight}kg · ${e.age}岁 ·
          目标 ${e.kcal} kcal / 蛋白 ${e.protein}g · ${fmtTime(e.ts)}</div>
      </div>
      <button type="button" class="mini-del" data-del="${escapeHtml(e.id)}"
        title="删除这条" aria-label="删除这条">×</button>
    </div>`).join('');
  card.classList.remove('hidden');
}

/* 用一条历史记录（或分享参数）重新跑分析 */
function applyProfile(src) {
  $('sex').querySelectorAll('.seg').forEach(b =>
    b.classList.toggle('active', b.dataset.val === src.sex));
  state.sex = src.sex;
  $('goal').querySelectorAll('.seg').forEach(b =>
    b.classList.toggle('active', b.dataset.val === src.goal));
  state.goal = src.goal;
  $('height').value = src.height;
  $('weight').value = src.weight;
  $('age').value = src.age;
  $('activity').value = String(src.activity);
  $('go').click();
}

/* ════════════ 一日三餐渲染 ════════════ */
function pctClass(pct, lo, hi) {
  return (pct >= lo && pct <= hi) ? 'ok' : 'off';
}

function renderPlan(plan) {
  const c = plan.coverage;
  const summary = `
    <div class="plan-summary">
      <div class="pm"><b class="${pctClass(c.kcalPct, 90, 110)}">${plan.day.kcal}</b>
        <span>全天热量 kcal（目标 ${plan.target.kcal}，${c.kcalPct}%）</span></div>
      <div class="pm"><b class="${pctClass(c.proteinPct, 90, 115)}">${plan.day.protein}g</b>
        <span>蛋白质（目标 ${plan.target.protein}g，${c.proteinPct}%）</span></div>
      <div class="pm"><b>${plan.day.cho}g</b>
        <span>碳水（目标 ${plan.target.carbG}g）</span></div>
      <div class="pm"><b>${plan.day.fat}g</b>
        <span>脂肪（目标 ${plan.target.fatG}g）</span></div>
    </div>`;

  const meals = plan.meals.map(m => {
    const items = m.items.map(it => `
      <div class="meal-item">
        <span class="mi-name"><span class="mi-tag">${it.slotLabel}</span>${escapeHtml(it.name)}</span>
        <span class="mi-grams">${it.grams} g</span>
        <span class="mi-macros">${Math.round(it.n.kcal)} kcal ·
          蛋白 ${it.n.protein}g · 脂肪 ${it.n.fat}g · 碳水 ${it.n.cho}g</span>
      </div>`).join('');

    return `<div class="meal">
      <div class="meal-head">
        <span class="m-name">${m.label}</span>
        <span class="m-cal">目标 ${m.target.kcal} kcal / 蛋白 ${m.target.protein}g</span>
      </div>
      ${items}
      <div class="meal-total">
        <span>本餐合计</span>
        <span><b>${m.totals.kcal} kcal</b> · 蛋白 ${m.totals.protein}g ·
          脂肪 ${m.totals.fat}g · 碳水 ${m.totals.cho}g</span>
      </div>
    </div>`;
  }).join('');

  const naNote = plan.day.na > 2000
    ? `<p class="small" style="color:var(--warn);margin:10px 0 0">
         全天钠 ${plan.day.na} mg，超过 2000 mg 建议上限，注意减少腌制与加工食品。</p>`
    : `<p class="small muted" style="margin:10px 0 0">
         全天钠 ${plan.day.na} mg（建议上限 2000 mg）· 膳食纤维 ${plan.day.fiber} g。</p>`;

  $('planResult').innerHTML = summary + meals + naNote;
  $('planResult').classList.remove('hidden');
}

/* ── 事件 ── */
function initSegmented(id, cb) {
  const box = $(id);
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    [...box.children].forEach(c => c.classList.toggle('active', c === btn));
    cb(btn.dataset.val);
  });
}

function readForm() {
  const height = parseFloat($('height').value);
  const weight = parseFloat($('weight').value);
  const age = parseFloat($('age').value);
  const errs = [];
  if (!(height >= 120 && height <= 230)) errs.push('身高需在 120–230 cm');
  if (!(weight >= 25 && weight <= 250)) errs.push('体重需在 25–250 kg');
  if (!(age >= 18 && age <= 100)) errs.push('年龄需在 18–100 岁（公式适用于成人）');
  return { height, weight, age, errs };
}

/* 当前表单值（含性别与目标），用于摘要卡展示"你的数据" */
function currentForm() {
  return {
    sex: state.sex,
    goal: state.goal,
    height: $('height').value,
    weight: $('weight').value,
    age: $('age').value
  };
}

function bind() {
  initSegmented('sex', v => state.sex = v);
  initSegmented('goal', v => state.goal = v);

  /* 搜索：输入防抖 200ms，输入框清空时收起结果 */
  let searchTimer = null;
  $('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearch, 200);
  });
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('searchInput').value = ''; renderSearch(); }
  });

  $('tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    state.tab = t.dataset.tab;
    state.expanded = false;
    renderRecs();
  });

  $('more').addEventListener('click', () => {
    state.expanded = !state.expanded;
    renderRecs();
  });

  /* ── 分栏折叠 ── */
  $('recList').addEventListener('click', (e) => {
    const t = e.target.closest('.sect-toggle');
    if (!t) return;
    const key = t.dataset.sec;
    if (state.collapsed.has(key)) state.collapsed.delete(key);
    else state.collapsed.add(key);
    renderRecs();
  });

  /* 全部折叠 / 展开（作用于当前标签页的所有分栏） */
  const allSectionKeys = () => {
    const defs = GROUPS[state.tab] || [];
    return defs.map(d => secKey(state.tab, d.key));
  };
  $('collapseAll').addEventListener('click', () => {
    allSectionKeys().forEach(k => state.collapsed.add(k));
    renderRecs();
  });
  $('expandAll').addEventListener('click', () => {
    allSectionKeys().forEach(k => state.collapsed.delete(k));
    renderRecs();
  });

  /* ── 功能总览跳转 ── */
  $('featGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.feat');
    if (!btn) return;
    const feat = FEATURES[+btn.dataset.feat];
    if (feat.needsInput && !state.profile) {
      toast('请先在步骤 1 填写身体数据并点「开始分析」');
      jumpTo('formCard');
      return;
    }
    /* 收藏/历史卡默认隐藏，没内容时给个说明 */
    if (!jumpTo(btn.dataset.goto)) {
      toast('这里还没有内容 —— 先去搜索食物或做一次分析');
      return;
    }
    if (feat.ai && $('aiAdvice').classList.contains('hidden')) {
      toast('AI 建议在分析后生成，若后端未启动会提示失败');
    }
  });

  /* ── 收藏：事件委托，推荐列表与搜索结果共用 ── */
  document.addEventListener('click', (e) => {
    const fav = e.target.closest('.fav-btn');
    if (fav) {
      e.stopPropagation();
      const res = toggleFavorite(fav.dataset.fav, fav.dataset.name);
      toast(res.added ? `已收藏「${fav.dataset.name}」` : `已取消收藏「${fav.dataset.name}」`);
      /* 同步页面上所有指向同一食物的星标 */
      document.querySelectorAll(`.fav-btn[data-fav="${CSS.escape(fav.dataset.fav)}"]`)
        .forEach(b => {
          b.classList.toggle('on', res.added);
          b.textContent = res.added ? '★' : '☆';
          b.title = res.added ? '取消收藏' : '加入收藏';
        });
      renderFavorites();
      return;
    }

    /* ── 历史：点条目恢复分析，点 × 删除 ── */
    const del = e.target.closest('.mini-del');
    if (del) {
      e.stopPropagation();
      removeHistory(del.dataset.del);
      renderHistory();
      return;
    }
    const item = e.target.closest('[data-restore]');
    if (item) {
      const rec = getHistory().find(x => x.id === item.dataset.restore);
      if (rec) { applyProfile(rec); toast('已按该记录重新分析'); }
    }
  });

  $('clearHistoryBtn').addEventListener('click', () => {
    clearHistory();
    renderHistory();
    toast('已清空历史记录');
  });
  $('clearFavBtn').addEventListener('click', () => {
    clearFavorites();
    renderFavorites();
    toast('已清空收藏');
  });

  /* ── 分享：把身体数据编码进链接 ── */
  $('shareBtn').addEventListener('click', async () => {
    const { height, weight, age, errs } = readForm();
    if (errs.length) { toast('请先填好身体数据再分享'); return; }
    const form = {
      sex: state.sex, height, weight, age,
      activity: parseFloat($('activity').value), goal: state.goal
    };
    const url = buildShareUrl(location.origin, location.pathname, form);
    try {
      if (navigator.share) {
        await navigator.share({ title: '我的营养分析', text: '这是我用食物营养分析工具算出的结果', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('链接已复制，粘贴给朋友即可');
    } catch (_) {
      /* 剪贴板不可用（如 http 非安全上下文）时把链接显示出来手动复制 */
      window.prompt('复制下面的链接分享：', url);
    }
  });

  $('resetBtn').addEventListener('click', () => {
    $('height').value = ''; $('weight').value = ''; $('age').value = '';
    $('result').classList.add('hidden');
    $('formMsg').textContent = '';
    $('height').focus();
  });
  /* 生成配餐：按当前画像即时计算（纯计算层，无需请求后端） */
  $('planBtn').addEventListener('click', () => {
    if (!state.profile) {
      $('formMsg').textContent = '请先填写身体数据并点击「开始分析」';
      return;
    }
    const btn = $('planBtn');
    btn.textContent = '正在计算…';
    btn.disabled = true;
    /* 让浏览器先画出"正在计算"，再跑同步计算 */
    setTimeout(() => {
      try {
        const plan = buildDayPlan(state.foods, state.profile, state.goal);
        renderPlan(plan);
        btn.textContent = '重新生成';
      } catch (err) {
        $('planResult').innerHTML =
          `<p class="small" style="color:var(--danger)">配餐生成失败：${escapeHtml(err.message)}</p>`;
        $('planResult').classList.remove('hidden');
        btn.textContent = '生成配餐';
      } finally {
        btn.disabled = false;
      }
    }, 30);
  });

  $('go').addEventListener('click', () => {
    const { height, weight, age, errs } = readForm();
    const msg = $('formMsg');
    if (errs.length) { msg.textContent = errs.join('；'); return; }
    msg.textContent = '';

    state.activity = parseFloat($('activity').value);
    const profile = computeProfile({
      sex: state.sex, height, weight, age, activity: state.activity, goal: state.goal
    });
    state.profile = profile;
    state.buckets = recommend(state.foods, state.goal);
    state.tab = 'protein';        // 优质蛋白是首要答案，默认展示
    state.expanded = false;

    renderSummary(profile);
    $('recIntro').textContent = state.goal === 'cut'
      ? '减脂优先：高蛋白 + 高纤维 + 低热量密度。蛋白质帮助保住肌肉，纤维提升饱腹感。'
      : '增肌优先：高蛋白 + 热量友好。主食与蛋白并重，训练后及时补充。';
    renderRecs();

    /* 记入历史 + 记住本次参数，下次打开自动回填 */
    const form = { sex: state.sex, height, weight, age, activity: state.activity, goal: state.goal };
    addHistory(compactEntry(profile, state.goal, form));
    saveLastProfile(form);
    renderHistory();
    renderFeatures();          // 分析完成后，功能总览里"待填写"的提示换成实际描述

    /* 新的画像 → 旧的配餐作废，避免与当前目标不符 */
    $('planResult').classList.add('hidden');
    $('planResult').innerHTML = '';
    $('planBtn').textContent = '生成配餐';

    $('result').classList.remove('hidden');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });

    /* AI 建议 */
      const aiBox = $('aiAdvice');
    aiBox.classList.remove('hidden');
    aiBox.textContent = 'AI 正在生成个性化建议…';

    const topFoods = (state.buckets.protein || [])
      .slice(0, 5).map(f => f.name).join('、');

    const prompt =
      `用户：${state.sex === 'male' ? '男' : '女'}，${age}岁，` +
      `${height}cm，${weight}kg，BMI ${profile.bmi.toFixed(1)}（${profile.bmiTag}）。` +
      `目标：${state.goal === 'cut' ? '减脂' : '增肌'}。` +
      `每日目标：热量 ${Math.round(profile.targetKcal)} kcal，` +
      `蛋白质 ${Math.round(profile.proteinTarget)}g，` +
      `碳水 ${Math.round(profile.carbG)}g，脂肪 ${Math.round(profile.fatG)}g。` +
      `系统已推荐的高蛋白食材包括：${topFoods}。` +
      `请用 3-4 句话，说明这些推荐为什么适合该用户，` +
      `并指出他这类人群最需要注意的一条饮食禁忌。`;

    getAIAdvice(prompt)
      .then(text => { aiBox.textContent = text; })
      .catch(err => { aiBox.textContent = 'AI 建议获取失败：' + err.message; });
  });
}

/* ── 启动 ── */
(async function main() {
  bind();
  renderFeatures();
  renderHistory();
  renderFavorites();

  try {
    const res = await fetch('data/foods.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.foods = await res.json();
    $('formMsg').textContent = '';

    /* 1) 分享链接优先：打开即复现对方的分析结果 */
    const shared = readShareFromHash(location.hash);
    if (shared) {
      applyProfile(shared);
      toast('已载入分享的分析结果');
      /* 清掉 hash，避免用户改完参数后刷新又被覆盖 */
      history.replaceState(null, '', location.pathname + location.search);
      return;
    }

    /* 2) 否则回填上次填过的数据，但不自动分析（避免每次打开都发起 AI 请求） */
    const last = getLastProfile();
    if (last) {
      $('height').value = last.height;
      $('weight').value = last.weight;
      $('age').value = last.age;
      $('activity').value = String(last.activity);
      $('sex').querySelectorAll('.seg').forEach(b =>
        b.classList.toggle('active', b.dataset.val === last.sex));
      state.sex = last.sex;
      $('goal').querySelectorAll('.seg').forEach(b =>
        b.classList.toggle('active', b.dataset.val === last.goal));
      state.goal = last.goal;
    }
  } catch (err) {
    $('formMsg').textContent =
      '数据加载失败：' + err.message +
      '。若直接双击打开 HTML，浏览器会拦截本地文件读取，请用本地服务器访问（见 README）。';
  }
})();
