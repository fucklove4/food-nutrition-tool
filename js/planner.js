/* ════════════════════════════════════════════════════════════
   planner.js — 一日三餐配餐（纯计算层，无 DOM）

   候选来源直接复用 rules.recommend() 的分桶结果：
   那里已经处理好了「主流度」（同名变体数 + 家常白名单）与
   「干制品/内脏/加工品」过滤，避免配餐出现连吃三顿羊肉、
   或把奶粉当一杯奶这类问题。这里只负责「选哪些槽位、给多少克」。
   ════════════════════════════════════════════════════════════ */
import { recommend } from './rules.js';

/* ── 餐次热量分配（占每日目标） ── */
export const MEAL_SPLIT = {
  cut: [
    { key: 'breakfast', label: '早餐', kcal: 0.25 },
    { key: 'lunch', label: '午餐', kcal: 0.35 },
    { key: 'dinner', label: '晚餐', kcal: 0.30 },
    { key: 'snack', label: '加餐', kcal: 0.10 }
  ],
  bulk: [
    { key: 'breakfast', label: '早餐', kcal: 0.25 },
    { key: 'lunch', label: '午餐', kcal: 0.30 },
    { key: 'dinner', label: '晚餐', kcal: 0.30 },
    { key: 'snack', label: '加餐（训练后）', kcal: 0.15 }
  ]
};

export const MEAL_SLOTS = {
  breakfast: ['dairy', 'staple', 'protein', 'fruit'],
  lunch: ['protein', 'staple', 'veg', 'veg', 'veg'],
  dinner: ['protein', 'staple', 'veg', 'veg', 'veg'],
  snack: ['dairy', 'fruit', 'staple', 'nut', 'nut']
};

/* 目标脂肪占比高时（增肌），午/晚餐各加一个烹调油槽位 */
const OIL_MEALS = new Set(['lunch', 'dinner']);

/* 增肌目标热量高（可达 3400 kcal），单份主食要给到 400g+ 才够，
   不现实。改为午/晚餐各放两份主食（如米饭 + 全麦馒头）。 */
const DOUBLE_STAPLE_MEALS = new Set(['lunch', 'dinner']);
function mealSlots(key, profile) {
  const base = [...(MEAL_SLOTS[key] || ['protein', 'staple', 'veg'])];
  const highEnergy = profile.targetKcal >= 2400;
  if (highEnergy && DOUBLE_STAPLE_MEALS.has(key)) base.push('staple');
  if (needsOil(profile) && OIL_MEALS.has(key)) base.push('oil');
  return base;
}

/* 坚果种子：能量密度高，是增肌期补足热量最自然的选择。
   仅用于加餐，减脂期不启用。 */
const NUT_SLOT_TARGET = { protein: 5, kcal: 180 };
const NUT_PORTION = { min: 20, max: 40, step: 10 };

/* 烹调油：增肌期热量与脂肪目标都高，仅靠瘦肉与低脂主食无法达标
   （会先撞上份量上限）。给一个 5-20g 的用油额度由优化器分配，
   这也是真实增肌饮食的常见做法。 */
const OIL_PORTION = { min: 5, max: 20, step: 5 };
const OIL_SLOT_TARGET = { protein: 0, kcal: 90 };

/* ── 每餐份量范围（g） ──
   所有槽位都随该餐热量缩放，只是下限/上限不同：
   若把蔬菜/水果/奶类的份量写死，低热量目标（久坐女性 1400 kcal）
   会因固定下限本身就占掉一半热量而必然超标。 */
const SCALED_PORTION = {
  /* kcalFrac：该槽位应占该餐热量的比例区间；kcalPer100：该槽位的典型能量密度 */
  staple: { kcalFrac: [0.20, 0.48], min: 40, max: 600, step: 25, kcalPer100: 250 },
  protein: { kcalFrac: [0.14, 0.34], min: 60, max: 220, step: 20, kcalPer100: 130 },
  veg: { kcalFrac: [0.03, 0.10], min: 100, max: 200, step: 25, kcalPer100: 30 },
  fruit: { kcalFrac: [0.05, 0.13], min: 100, max: 200, step: 50, kcalPer100: 50 },
  dairy: { kcalFrac: [0.12, 0.30], min: 200, max: 300, step: 50, kcalPer100: 60 },
  nut: { kcalFrac: [0.15, 0.32], min: 20, max: 40, step: 10, kcalPer100: 600 },
  oil: { kcalFrac: [0.04, 0.12], min: 5, max: 20, step: 5, kcalPer100: 900 }
};

function portionRule(slot, mealKcal) {
  const cfg = SCALED_PORTION[slot];
  if (!cfg) return null;
  const lo = cfg.kcalFrac[0] * mealKcal / cfg.kcalPer100 * 100;
  const hi = cfg.kcalFrac[1] * mealKcal / cfg.kcalPer100 * 100;
  const snap = (v) => Math.round(v / cfg.step) * cfg.step;
  const min = Math.max(cfg.min, snap(lo));
  const max = Math.max(min + cfg.step, Math.min(cfg.max, snap(hi)));
  return { min, max, step: cfg.step };
}

const SLOT_TARGET = {
  protein: { protein: 28, kcal: 150 },
  staple: { protein: 4, kcal: 170 },
  veg: { protein: 2, kcal: 40 },
  fruit: { protein: 1, kcal: 70 },
  dairy: { protein: 8, kcal: 140 },
  nut: NUT_SLOT_TARGET,
  oil: OIL_SLOT_TARGET
};

const SLOT_LABEL = {
  protein: '蛋白质', staple: '主食', veg: '蔬菜', fruit: '水果',
  dairy: '奶类', nut: '坚果', oil: '烹调油'
};

/* 冲泡类/干粉类：每 100g 是干粉，绝不能按「一杯」估份量 */
const POWDER_RX = /奶粉|配方|蛋白粉|奶片|粉$|炼乳|奶皮|奶豆腐|奶疙瘩|奶酪|乳酪|干酪|冰淇淋|雪糕/;
/* 果干：每 100g 热量是鲜果的 3-5 倍，份量语义不同 */
const DRIED_FRUIT_RX = /干$|蜜饯|果脯|果酱|罐头|罐装/;

/* ── 构建候选池：从 recommend() 的结果里挑，并保证多样性 ──
   recommend() 的 protein 桶按来源分栏（禽/红肉/水产/蛋/奶/豆），
   这里每个分栏各取若干，避免整池都是羊肉。 */
function buildPools(foods, goal) {
  const b = recommend(foods, goal, true);

  /* 蛋白：按 slot 分栏各取前 6，保证来源多样 */
  const bySlot = {};
  for (const f of b.protein) (bySlot[f.slot] ||= []).push(f);
  const protein = [];
  for (const k of ['poultry', 'redmeat', 'aquatic', 'egg', 'soy', 'other']) {
    for (const f of (bySlot[k] || []).slice(0, 6)) protein.push(f);
  }

  /* 奶类：只保留可整杯饮用的（牛奶/酸奶），排除干粉与配方 */
  const dairy = [];
  for (const f of (bySlot.dairy || [])) {
    if (POWDER_RX.test(f.name)) continue;
    if (f.protein == null || f.protein < 2.5) continue;
    if (f.fat != null && f.fat > 5) continue;          // 全脂奶脂肪 3.5 左右仍可用
    dairy.push(f);
    if (dairy.length >= 6) break;
  }

  /* 主食排除魔芋精粉这类"看似主食"的高纤维制品：
     每 100g 含 74g 膳食纤维，现实中不可能吃 100g，按主食估份量会严重失真 */
  const staple = b.staple
    .filter(f => f.kcal >= 110 && f.kcal <= 400 && (f.fiber == null || f.fiber < 20))
    .slice(0, 10);
  const veg = b.veg.filter(f => f.kcal <= 100).slice(0, 10);
  const fruit = b.fruit.filter(f => f.kcal <= 150 && !DRIED_FRUIT_RX.test(f.name)).slice(0, 8);

  /* 坚果种子：recommend() 不把它们放进 protein 桶，直接从原始数据取。
     条件：坚果种子类、非干制品、数据完整，按能量密度排序 */
  const nut = foods
    .filter(f => f.cat === '坚果种子类' && f.kcal != null && f.protein != null
                 && f.fat != null && f.cho != null && f.kcal > 300
                 && !/干$|蜜饯|罐头|粉$/.test(f.name))
    .sort((a, c) => (c.protein || 0) - (a.protein || 0))
    .slice(0, 6);

  /* 烹调油：从植物油类取，按名称简短者优先（通常是"花生油""豆油"这类主条目） */
  const oil = foods
    .filter(f => f.cat === '植物油' && f.kcal != null && f.kcal > 800)
    .sort((a, c) => a.name.length - c.name.length)
    .slice(0, 4);

  return { protein, staple, veg, fruit, dairy, nut, oil };
}

/* 该餐是否需要烹调油槽位：目标脂肪占热量比 ≥25% 时才加，
   否则减脂餐会凭空多出 100-200 kcal。
   （减脂目标约 23%，增肌目标约 27%） */
function needsOil(profile) {
  const fatKcalFrac = (profile.fatG * 9) / profile.targetKcal;
  return fatKcalFrac >= 0.25;
}

function nutr(f, grams) {
  const r = grams / 100;
  return {
    kcal: (f.kcal || 0) * r, protein: (f.protein || 0) * r,
    fat: (f.fat || 0) * r, cho: (f.cho || 0) * r,
    fiber: (f.fiber || 0) * r, na: (f.na || 0) * r
  };
}

const round = (v) => Math.round(v * 10) / 10;

/* 偏差评分：超标惩罚是不足的 2 倍（配多了比配少了更糟） */
function dev(actual, target, weight) {
  const d = (actual - target) / Math.max(target, 1);
  return -(d > 0 ? d * 2 : -d) * weight;
}

function mealScoreOf(arr, mealTarget) {
  const t = arr.reduce((a, p) => ({
    kcal: a.kcal + p.n.kcal, protein: a.protein + p.n.protein,
    fat: a.fat + p.n.fat, cho: a.cho + p.n.cho
  }), { kcal: 0, protein: 0, fat: 0, cho: 0 });
  let s = 0;
  s += dev(t.kcal, mealTarget.kcal, 120);
  s += dev(t.protein, mealTarget.protein, 150);
  s += dev(t.fat, mealTarget.fat, 30);
  s += dev(t.cho, mealTarget.cho, 30);
  const names = arr.map(p => p.food.name);
  s -= (names.length - new Set(names).size) * 90;   // 同餐不重复同一食材
  return s;
}

/* ── 一餐的份量优化：坐标下降 ──
   贪心（定完不再改）会失败：先选了小份肉，之后热量不够也无法回头调大。
   这里先出初始解，再反复回头重优化每个槽位，只接受更优改动，必然收敛。 */
function optimizeMeal(pools, slots, mealTarget, used) {
  const mealKcal = mealTarget.kcal;

  const evalSlot = (slot, others) => {
    const rule = portionRule(slot, mealKcal);
    const otherNames = new Set(others.map(p => p.food.name));
    const base = others.reduce((a, p) => ({
      kcal: a.kcal + p.n.kcal, protein: a.protein + p.n.protein,
      fat: a.fat + p.n.fat, cho: a.cho + p.n.cho
    }), { kcal: 0, protein: 0, fat: 0, cho: 0 });

    let best = null;
    for (const f of pools[slot] || []) {
      if (otherNames.has(f.name)) continue;
      if ((slot === 'protein' || slot === 'staple') && used.has(f.name)) continue;
      /* 蔬菜/水果/坚果也用过的，给软惩罚而不是硬排除：
         否则池子不够时可能配不出这一槽位 */
      const isRepeat = used.has(f.name);
      for (let g = rule.min; g <= rule.max; g += rule.step) {
        const n = nutr(f, g);
        const cand = { slot, food: f, grams: g, n };
        let s = mealScoreOf([...others, cand], mealTarget);
        s += dev(n.protein, SLOT_TARGET[slot].protein, 16);
        s += dev(n.kcal, SLOT_TARGET[slot].kcal, 10);
        s -= Math.min(n.na, 800) / 800 * 10;
        s += Math.min(n.fiber, 8) * 0.6;
        if (isRepeat) s -= (slot === 'protein' || slot === 'staple') ? 60 : 28;
        if (!best || s > best.s) best = { s, ...cand };
      }
    }
    return best;
  };

  /* 初始解 */
  let picks = [];
  for (const slot of slots) {
    const p = evalSlot(slot, picks);
    if (p) picks.push({ slot, food: p.food, grams: p.grams, n: p.n });
  }
  if (!picks.length) return [];

  let bestScore = mealScoreOf(picks, mealTarget);
  for (let pass = 0; pass < 5; pass++) {
    let improved = false;
    for (let i = 0; i < picks.length; i++) {
      const others = picks.filter((_, j) => j !== i);
      const cand = evalSlot(picks[i].slot, others);
      if (!cand) continue;
      const trial = [...others, { slot: cand.slot, food: cand.food, grams: cand.grams, n: cand.n }];
      const sc = mealScoreOf(trial, mealTarget);
      if (sc > bestScore + 1e-9) {
        picks = trial;
        bestScore = sc;
        improved = true;
      }
    }
    if (!improved) break;
  }

  const order = { protein: 0, staple: 1, dairy: 2, veg: 3, fruit: 4 };
  return picks.sort((a, b) => order[a.slot] - order[b.slot]);
}

/* ── 主入口 ── */
export function buildDayPlan(foods, profile, goal) {
  const pools = buildPools(foods, goal);
  const meals = MEAL_SPLIT[goal] || MEAL_SPLIT.cut;
  const used = new Set();
  const result = [];

  for (const meal of meals) {
    const mealTarget = {
      kcal: profile.targetKcal * meal.kcal,
      protein: profile.proteinTarget * meal.kcal,
      fat: profile.fatG * meal.kcal,
      cho: profile.carbG * meal.kcal
    };
    const slots = mealSlots(meal.key, profile);
    const picks = optimizeMeal(pools, slots, mealTarget, used);

    const items = picks.map(pick => {
      if (pick.slot === 'protein' || pick.slot === 'staple') used.add(pick.food.name);
      return {
        code: pick.food.code, name: pick.food.name,
        slot: pick.slot, slotLabel: SLOT_LABEL[pick.slot], cat: pick.food.cat,
        grams: pick.grams,
        n: {
          kcal: round(pick.n.kcal), protein: round(pick.n.protein),
          fat: round(pick.n.fat), cho: round(pick.n.cho),
          fiber: round(pick.n.fiber), na: round(pick.n.na)
        },
        per100: {
          kcal: pick.food.kcal, protein: pick.food.protein,
          fat: pick.food.fat, cho: pick.food.cho
        }
      };
    });

    const totals = items.reduce((a, it) => ({
      kcal: a.kcal + it.n.kcal, protein: a.protein + it.n.protein,
      fat: a.fat + it.n.fat, cho: a.cho + it.n.cho,
      fiber: a.fiber + it.n.fiber, na: a.na + it.n.na
    }), { kcal: 0, protein: 0, fat: 0, cho: 0, fiber: 0, na: 0 });

    result.push({
      key: meal.key, label: meal.label,
      target: {
        kcal: Math.round(mealTarget.kcal), protein: Math.round(mealTarget.protein),
        fat: Math.round(mealTarget.fat), cho: Math.round(mealTarget.cho)
      },
      items,
      totals: {
        kcal: Math.round(totals.kcal), protein: round(totals.protein),
        fat: round(totals.fat), cho: round(totals.cho),
        fiber: round(totals.fiber), na: Math.round(totals.na)
      }
    });
  }

  const day = result.reduce((a, m) => ({
    kcal: a.kcal + m.totals.kcal, protein: a.protein + m.totals.protein,
    fat: a.fat + m.totals.fat, cho: a.cho + m.totals.cho,
    fiber: a.fiber + m.totals.fiber, na: a.na + m.totals.na
  }), { kcal: 0, protein: 0, fat: 0, cho: 0, fiber: 0, na: 0 });

  const t = profile.targetKcal;
  return {
    meals: result,
    day: {
      kcal: day.kcal, protein: round(day.protein), fat: round(day.fat),
      cho: round(day.cho), fiber: round(day.fiber), na: day.na
    },
    target: {
      kcal: Math.round(t), protein: Math.round(profile.proteinTarget),
      carbG: Math.round(profile.carbG), fatG: Math.round(profile.fatG)
    },
    coverage: {
      kcalPct: Math.round(day.kcal / t * 100),
      proteinPct: Math.round(day.protein / profile.proteinTarget * 100),
      carbPct: Math.round(day.cho / profile.carbG * 100),
      fatPct: Math.round(day.fat / profile.fatG * 100),
      fiber: round(day.fiber), na: day.na
    }
  };
}

export { SLOT_LABEL, SLOT_TARGET };

