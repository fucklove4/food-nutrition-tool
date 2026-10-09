/* ════════════════════════════════════════════════════════════
   rules.js — 纯计算层（无 DOM 依赖）
   可同时被浏览器（<script type="module">）与 Node 引用，
   便于用真实数据直接测试推荐结果。
   ════════════════════════════════════════════════════════════ */
'use strict';

/* ── 阈值（取自本数据集实际分布） ── */
export const TH = {
  proteinHigh: 20, proteinFair: 12, proteinDense: 10,
  fiberHigh: 6, fiberFair: 3,
  fatHigh: 20, fatLow: 5,
  naLow: 120, naHigh: 600,
  cholHigh: 300,
  kcalLow: 100, kcalHigh: 400,
  choHigh: 60
};

export const CAT2TYPE = {
  '蔬菜类及其制品': 'veg', '菌藻类': 'veg', '水果类及其制品': 'fruit',
  '谷类及其制品': 'staple', '薯类淀粉及其制品': 'staple',
  '畜肉类及其制品': 'protein', '禽肉类及其制品': 'protein', '鱼虾蟹贝类': 'protein',
  '蛋类及其制品': 'protein', '乳类及其制品': 'dairy', '干豆类及其制品': 'legume',
  '坚果种子类': 'nut', '植物油': 'fat', '动物油脂类': 'fat', '其他类': 'staple'
};

export const SERVING = { veg: 200, fruit: 200, staple: 100, protein: 100, dairy: 250, legume: 50, nut: 20, fat: 10 };

/* 动物性 / 药食同源关键词（用于修正“其他类”里的分类错误） */
const ANIMAL_RX = /(鱼|鲨|鳕|鲈|鲤|鲫|鲢|鳙|鳝|鳗|鱿|鲍|参|翅|肚|唇|裙边|蹄|筋|鞭|掌|骨|髓|血|肝|肾|心|肺|肠|肚|脑|舌|耳|皮|龟|鳖|蛙|蛇|虾|蟹|贝|螺|蚝|蛤|蛎|蜇|鸡|鸭|鹅|鸽|鹌鹑|牛|羊|猪|马|驴|兔|鹿|蜂|蛹|蝎|蚕|阿胶|蛤蚧|螵蛸|刺猬|海参|雪蛤)/;
const MEDICINE_RX = /(甲|胶|蛸|蚧|皮|鞭|掌|骨|髓|茸|鞭)/;

export function foodType(f) {
  let t = CAT2TYPE[f.cat] || 'staple';

  /* 蜂蛹/蚕蛹等昆虫虽列入“其他类/谷类”，但属动物性高蛋白食材 */
  if (/蜂蛹|蚕蛹|蝎|蝗虫|知了|蝉|蚁|虫/.test(f.name) && (f.protein || 0) >= 10) {
    return 'protein';
  }
  /* “其他类”常含动物性/药食同源食材，按名称与成分归位 */
  if (t === 'staple' && f.cat === '其他类') {
    if (f.fat != null && f.fat > 60 && (f.protein == null || f.protein < 20)) return 'fat';
    if (f.protein != null && f.protein >= 15 && ANIMAL_RX.test(f.name)) return 'protein';
  }
  /* 谷薯类里偶尔出现高脂高蛋白的动物性条目 */
  if (t === 'staple' && f.fat != null && f.fat > 60 && (f.protein == null || f.protein < 20)) {
    return 'fat';
  }
  return t;
}

/* ── 日常食材过滤：排除干制品与药食同源/冷门食材 ── */
/* 注意「干」字必须区分：干贝/干香菇/脱水蔬菜 是干制品，
   但 豆腐干、鸡蛋、饼干、干酪 不是。 */
export function isDried(f) {
  const n = f.name;
  if (/脱水/.test(n)) return true;
  /* 去掉括号内容：避免“墨鱼（干，曼氏无针乌贼）”里的“干，”误判，
     同时“紫菜（干）”这类仍需靠括号内的“干”识别 */
  const core = n.replace(/[（(\[].*?[）)\]]/g, '').trim();
  /* 真正的干制品：干香菇/干辣椒/紫菜干…；
     不能匹配 饼干/干贝/干酪/豆腐干/鸡蛋 —— 故限定后缀与常见干制食材名 */
  if (/干(香菇|木耳|银耳|辣椒|海带|紫菜|笋|蘑|菌|虾|贝|鱼|果|枣|菜|豆角|豇豆|萝卜|黄花|苔|蕨|梅|杏|桃|葡萄|荔枝|龙眼|无花果|柿|肉|肠|板栗|莲子|百合|山药)/.test(core)) return true;
  if (/干$/.test(core)) return true;
  if (/[日风]干|风干/.test(core)) return true;
  /* 括号内单独一个“干”字（紫菜（干）、香菇（干）） */
  if (/[（(]\s*干\s*[）)]/.test(n)) return true;
  /* 干制小水产：虾米/海米/虾皮/干贝/鱼肚等 */
  if (/(虾米|海米|虾皮|开洋|干贝|鱼肚|鱼唇|裙边|鲍鱼干|蛏干|淡菜)/.test(n)) return true;
  /* 水分很低 + 热量高 → 干制品（鱼翅、干贝等） */
  if (f.water != null && f.water < 20 && f.kcal != null && f.kcal > 250) return true;
  /* 水分很低 + 蛋白密度异常高 → 干制小水产（虾米 water≈? P=43.7） */
  if (f.water != null && f.water < 40 && f.protein != null && f.protein > 30) return true;
  return false;
}

/* ── 常见家常蛋白食材（白名单）：变体数无法反映“家常度”
     （鸡胸脯肉只有 1 条，而某品牌奶粉有 8 条） ── */
const COMMON_PROTEIN_RX = new RegExp(
  '^(?:' + [
    '鸡胸', '鸡腿', '鸡翅', '鸡肉', '鸡蛋', '鸡', '鸭', '鹅', '鸽', '鹌鹑',
    '猪', '牛', '羊', '兔', '驴', '马',
    '带鱼', '草鱼', '鲫鱼', '鲤鱼', '鲈鱼', '鲢鱼', '鳙鱼', '鳊鱼', '黄鱼',
    '鳕鱼', '鲳鱼', '鲅鱼', '三文鱼', '鲑鱼', '鳗', '鳝', '罗非鱼', '武昌鱼',
    '虾', '蟹', '蛤', '牡蛎', '扇贝', '鱿鱼', '墨鱼', '海参', '蛏', '蚬',
    '牛奶', '牛乳', '酸奶', '奶粉', '羊奶',
    '豆腐', '豆浆', '腐竹', '黄豆', '黑豆', '青豆', '豆干'
  ].join('|') + ')'
);

export function commonness(f) {
  const t = foodType(f);
  if (t !== 'protein') return 1;                 // 非动物性不受此限
  let c = 0;
  if (COMMON_PROTEIN_RX.test(f.name)) c += 0.6;
  const v = f.var || 1;
  c += v >= 20 ? 0.4 : v >= 10 ? 0.32 : v >= 5 ? 0.24 : v >= 3 ? 0.16 : v >= 2 ? 0.08 : 0;
  return Math.min(c, 1);
}

/* 动物性食物里少见的部位/药食同源条目 */
const OFFAL_RX = /(鞭|掌|筋|唇|裙边|翅|甲|胶|蛸|蚧|皮|骨|髓|茸|内脏|血|舌|耳|鼻|尾|蹄|脑|肝|肾|肺|肠|肚|心|膈|脾|腺|管|膜|膏|油|冻)/;

export function commonalityPenalty(f) {
  let pen = 0;
  if (isDried(f)) pen += 60;                     // 干制品：需泡发，不是即食食材
  const t = foodType(f);
  if (t === 'protein' && OFFAL_RX.test(f.name)) pen += 45;   // 内脏/稀奇部位
  if (MEDICINE_RX.test(f.name) && t === 'protein') pen += 25;
  if (/冻|罐|罐装/.test(f.name)) pen += 15;
  /* 冷门食材兜底：全库仅此一条且名字带别名方括号的，多半是地方性/罕见食材 */
  if ((f.var || 1) <= 1 && /[\[\]]/.test(f.name)) pen += 40;
  if ((f.var || 1) <= 1 && t === 'protein' && pen === 0) pen += 28;
  return pen;
}

/* 默认推荐只展示日常食材 */
export function isEveryday(f) {
  const t = foodType(f);
  if (t === 'fat') return false;
  if (isDried(f)) return false;
  if (t === 'protein' && OFFAL_RX.test(f.name)) return false;
  return true;
}

/* ── 优点 / 注意：由营养成分推导 ── */
export function derive(f) {
  const pros = [], warns = [], notes = [];

  if (f.protein != null && f.protein >= TH.proteinHigh) {
    pros.push('高蛋白');
    if ((f.fat == null || f.fat <= 10) && (f.kcal == null || f.kcal <= 200)) pros.push('优质瘦肉级蛋白');
  } else if (f.protein != null && f.protein >= TH.proteinFair) {
    pros.push('蛋白质较好');
  }
  if (f.pp != null && f.pp >= TH.proteinDense) pros.push('蛋白密度高');
  if (f.fiber != null && f.fiber >= TH.fiberHigh) pros.push('高纤维');
  else if (f.fiber != null && f.fiber >= TH.fiberFair) pros.push('含膳食纤维');
  if (f.kcal != null && f.kcal > 0 && f.kcal < TH.kcalLow) pros.push('低热量密度');
  if (f.fat != null && f.fat <= TH.fatLow) pros.push('低脂');
  if (f.na != null && f.na <= TH.naLow) pros.push('低钠');
  if (f.k != null && f.k >= 300) pros.push('富钾');
  if (f.ca != null && f.ca >= 150) pros.push('高钙');
  if (f.fe != null && f.fe >= 5) pros.push('富铁');
  if (f.se != null && f.se >= 20) pros.push('富硒');
  if (f.vc != null && f.vc >= 40) pros.push('富含维生素C');

  if (f.na != null && f.na > TH.naHigh) {
    warns.push('高钠');
    notes.push(`钠 ${f.na} mg/100g，高血压、心血管疾病、肾病人群需严格限量`);
  }
  if (f.chol != null && f.chol > TH.cholHigh) {
    warns.push('高胆固醇');
    notes.push(`胆固醇 ${f.chol} mg/100g，血脂异常、高胆固醇人群需限量`);
  }
  if (f.fat != null && f.fat > TH.fatHigh) {
    warns.push('高脂');
    if (f.fat > 50) notes.push(`脂肪 ${f.fat} g/100g，减脂期应控制用量`);
  }
  if (f.kcal != null && f.kcal > TH.kcalHigh) {
    warns.push('高热量密度');
    notes.push(`热量 ${f.kcal} kcal/100g，控制份量是关键`);
  }
  if (f.cho != null && f.cho >= TH.choHigh && (f.fiber == null || f.fiber < 3)) {
    warns.push('高碳水·低纤维');
    notes.push('碳水高且纤维少，血糖管理人群应控制份量并搭配蛋白质/蔬菜');
  }
  if (f.cat === '鱼虾蟹贝类' && f.sub === '其他') {
    notes.push('海产/内脏类，痛风或高尿酸人群需谨慎');
  }
  if (f.fiber == null || f.chol == null || f.na == null) {
    notes.push('部分营养数据缺失（原书未检出），判断时请留意');
  }
  return { pros, warns, notes };
}

/* ── 主流度加成：同一基础名的变体越多，越是主流食材 ──
   数据驱动，无需人工白名单（鸡/鸡蛋/牛肉变体多，双髻鲨/牛鞭只有 1 条） */
function commonBonus(f) {
  const v = f.var || 1;
  if (v >= 40) return 55;
  if (v >= 20) return 45;
  if (v >= 10) return 34;
  if (v >= 5) return 22;
  if (v >= 3) return 12;
  if (v >= 2) return 5;
  return 0;
}

/* ── 评分：每一类食材按自己的“本职”评价 ──
   关键点：不能把蔬菜按“蛋白密度”排（9 kcal 的菜会因为 1.6g 蛋白拿满分）。
   蛋白质看绝对蛋白与瘦肉度，蔬菜看纤维，主食看缓释碳水。 */
export function score(f, goal) {
  const p = f.protein, fi = f.fiber, kc = f.kcal, fa = f.fat,
        na = f.na, chol = f.chol, cho = f.cho, t = foodType(f);
  const base = commonBonus(f) - commonalityPenalty(f);
  let s = base;

  if (t === 'protein' || t === 'dairy' || t === 'legume') {
    /* 蛋白质来源：绝对蛋白量 + 蛋白密度 + 瘦肉度 + 钠/胆固醇
       注意：热量加成必须很小，否则奶酪会压过鸡胸肉 */
    s += Math.min(p || 0, 45) * (goal === 'bulk' ? 3.9 : 3.2);
    if (kc != null && p != null && kc > 0) s += Math.min(p / kc * 100, 24) * 2.2;
    if (fa != null) s -= Math.min(fa, 60) * (fa > 20 ? 1.0 : 0.5);
    if (goal === 'cut' && kc != null) s -= Math.min(kc, 600) * 0.055;
    if (goal === 'bulk' && kc != null && kc > 300) s += 4;
    if (goal === 'bulk' && kc != null && kc < 90) s -= 10;    // 增肌要够热量
    if (fa != null && fa <= 5 && (p || 0) >= 15) s += 14;     // 瘦肉加分
    s += Math.min(fi || 0, 15) * (goal === 'bulk' ? 0.8 : 1.5);
  } else if (t === 'veg') {
    /* 蔬菜菌藻：纤维为主，热量越低越好，避免高碳水淀粉类蔬菜 */
    s += Math.min(fi || 0, 20) * 4.2;
    if (kc != null) s += Math.max(0, 120 - kc) * 0.28;
    if (cho != null) s -= Math.min(cho, 40) * 0.9;
    s += Math.min(f.vc || 0, 100) * 0.12;
    if (fi == null) s -= 18;                                   // 缺纤维数据，不可信
  } else if (t === 'fruit') {
    s += Math.min(fi || 0, 15) * 3.4;
    if (kc != null) s += Math.max(0, 150 - kc) * 0.22;
    if (cho != null) s -= Math.min(cho, 60) * 0.75;
    s += Math.min(f.vc || 0, 120) * 0.14;
    if (fi == null) s -= 14;
  } else if (t === 'staple') {
    if (goal === 'cut') {
      if (kc != null) s += Math.max(0, 260 - kc) * 0.30;       // 低热量密度
      s += Math.min(fi || 0, 15) * 3.6;                        // 缓释碳水
      if (cho != null && cho >= 60 && (fi == null || fi < 3)) s -= 30;
      if (p != null && p >= 8) s += 12;
    } else {
      if (kc != null) s += Math.min(kc, 400) * 0.10;           // 需要热量
      s += Math.min(p || 0, 25) * 1.2;
      s += Math.min(fi || 0, 15) * 1.6;
      if (cho != null && cho >= 60 && (fi == null || fi < 3)) s -= 12;
    }
  }
  /* 通用：钠与胆固醇对所有类型都是减分项 */
  if (na != null) s -= Math.min(na, 3000) * (goal === 'cut' ? 0.016 : 0.010);
  if (chol != null) s -= Math.min(chol, 2000) * 0.006;
  return s;
}

/* 是否为“优质蛋白来源” —— 奶类和豆类的蛋白门槛不同，
   牛奶只有 3 g/100g、豆腐 6.6 g/100g，但它们都是正经蛋白来源 */
export function proteinFloor(f) {
  const t = foodType(f);
  if (t === 'protein') return 10;   // 肉蛋鱼虾
  if (t === 'dairy') return 2.5;    // 牛奶/酸奶
  if (t === 'legume') return 5;     // 豆腐/豆浆
  return Infinity;
}

export function isProteinSource(f) {
  const t = foodType(f);
  if (t !== 'protein' && t !== 'dairy' && t !== 'legume') return false;
  return f.protein != null && f.protein >= proteinFloor(f);
}
export const isVeg = (f) => foodType(f) === 'veg';
export const isFruit = (f) => foodType(f) === 'fruit';
export const isStaple = (f) => foodType(f) === 'staple' && f.kcal != null && f.kcal >= 40;

/* ── 蛋白来源分栏：让家常食材一定有机会出现 ──
   否则榜首会被“驴肉(酱)/马肉(卤)”这类高蛋白但少见的食物长期占据。
   分栏定义见上方 GROUPS.protein。 */
export function slotOf(f) {
  const cat = f.cat, sub = f.sub || '';
  if (cat === '蛋类及其制品') return 'egg';
  if (cat === '乳类及其制品') return 'dairy';
  if (cat === '干豆类及其制品') return 'soy';
  if (cat === '禽肉类及其制品') return 'poultry';
  if (cat === '畜肉类及其制品') return 'redmeat';
  if (cat === '鱼虾蟹贝类') return 'aquatic';
  if (/鸡|鸭|鹅|鸽|鹌鹑|火鸡/.test(sub)) return 'poultry';
  if (/牛|羊|猪|马|驴|兔/.test(sub)) return 'redmeat';
  /* “其他类”里的动物性食材按名称判断 */
  if (/鱼|虾|蟹|贝|蛤|蛎|鱿|墨|参|螺|蛏|蚬|翅|肚|唇/.test(f.name)) return 'aquatic';
  if (/鸡蛋|鸭蛋|鹅蛋|鹌鹑蛋|蛋黄|蛋白/.test(f.name)) return 'egg';
  return 'other';
}

/* ── 去重：同一食材的不同品牌/规格只保留得分最高的一条 ──
   例：孕产妇配方奶粉有 8 个品牌，纯牛奶有 59 个厂商变体，
   不过滤会让榜单被同一种食物刷屏。 */
export function dedupeVariants(list) {
  const seen = new Set();
  const out = [];
  for (const f of list) {
    /* 去掉品牌/产地/厂商，但保留“全脂/脱脂/低脂”这类有意义的区分 */
    const fatLevel = (f.name.match(/全脂|脱脂|低脂|部分脱脂/) || [''])[0];
    const base = f.name
      .replace(/[（(\[].*?[）)\]]/g, '')
      .replace(/\s+/g, '')
      .trim() || f.name;
    const k = base + '|' + fatLevel;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

/* ════════════ 功能分栏 ════════════
   平铺按分数排序会让「辣椒(纤维11.8g)」压过西红柿、黄瓜，家常菜永远排不上。
   改为按食材的功能/部位分栏（与《中国食物成分表》的分类一致），
   每栏各取前几名 —— 这样叶菜、瓜茄、根茎、菌藻都有代表。 */

export const GROUPS = {
  protein: [
    { key: 'poultry', label: '禽肉' },
    { key: 'redmeat', label: '红肉' },
    { key: 'aquatic', label: '鱼虾贝' },
    { key: 'egg', label: '蛋类' },
    { key: 'dairy', label: '奶类' },
    { key: 'soy', label: '豆制品' },
    { key: 'other', label: '其他' }
  ],
  veg: [
    { key: 'leaf', label: '嫩茎叶花菜', match: ['嫩茎叶花菜类'] },
    { key: 'gourd', label: '茄果瓜菜', match: ['茄果瓜菜类'] },
    { key: 'root', label: '根菜类', match: ['根菜类'] },
    { key: 'allium', label: '葱蒜类', match: ['葱蒜类'] },
    { key: 'aquatic', label: '水生蔬菜', match: ['水生蔬菜类'] },
    { key: 'tuber', label: '薯芋类', match: ['薯芋类'] },
    { key: 'bean', label: '鲜豆类', match: ['鲜豆类'] },
    { key: 'wild', label: '野生蔬菜', match: ['野生蔬菜类'] },
    { key: 'fungi', label: '菌类', match: ['菌类'] },
    { key: 'algae', label: '藻类', match: ['藻类'] }
  ],
  fruit: [
    { key: 'pome', label: '仁果类', match: ['仁果类'] },
    { key: 'citrus', label: '柑橘类', match: ['柑橘类'] },
    { key: 'stone', label: '核果类', match: ['核果类'] },
    { key: 'berry', label: '浆果类', match: ['浆果类'] },
    { key: 'tropical', label: '热带亚热带', match: ['热带亚热带水果'] },
    { key: 'melon', label: '瓜果类', match: ['瓜果类'] }
  ],
  staple: [
    { key: 'rice', label: '稻米', match: ['稻米'] },
    { key: 'wheat', label: '小麦面食', match: ['小麦'] },
    { key: 'corn', label: '玉米', match: ['玉米'] },
    { key: 'millet', label: '小米黄米', match: ['小米黄米'] },
    { key: 'barley', label: '大麦', match: ['大麦'] },
    { key: 'potato', label: '薯类', match: ['薯类'] },
    { key: 'starch', label: '淀粉类', match: ['淀粉类'] },
    { key: 'grainOther', label: '其他谷类', match: ['其他'] }
  ]
};

/* 返回该食物在对应 tab 下的分栏 key */
export function groupKeyOf(f, tab) {
  const defs = GROUPS[tab];
  if (!defs) return 'other';
  if (tab === 'protein') return f.slot || 'other';
  for (const d of defs) {
    if (d.match && d.match.includes(f.sub)) return d.key;
  }
  return 'other';
}
/* ── 常见蔬果白名单 ──
   纯按纤维排序会让「辣椒(11.8g)/刺梨」这类高纤维但少吃的食材霸榜，
   西红柿、黄瓜、苹果反而排不上。给日常蔬果一个常见度加成。 */
const COMMON_VEG_RX = /大白菜|小白菜|白菜|菠菜|油菜|生菜|芹菜|韭菜|空心菜|茼蒿|芥蓝|菜心|甘蓝|圆白菜|卷心菜|西兰花|菜花|花椰菜|西红柿|番茄|黄瓜|茄子|辣椒|甜椒|青椒|冬瓜|南瓜|丝瓜|苦瓜|西葫芦|萝卜|胡萝卜|洋葱|大葱|蒜|姜|莲藕|山药|芋头|豆角|四季豆|豇豆|豌豆|毛豆|香菇|平菇|金针菇|木耳|海带|紫菜|蘑菇|口蘑|竹笋|莴笋|芦笋/;

const COMMON_FRUIT_RX = /苹果|香蕉|柑橘|橘子|橙|柚|柠檬|葡萄|桃|梨|西瓜|哈密瓜|甜瓜|草莓|蓝莓|猕猴桃|芒果|菠萝|荔枝|龙眼|枣|石榴|柿子|樱桃|李子|无花果|火龙果|木瓜/;

export function produceBonus(f, t) {
  if (t === 'veg' && COMMON_VEG_RX.test(f.name)) return 28;
  if (t === 'fruit' && COMMON_FRUIT_RX.test(f.name)) return 24;
  return 0;
}

/* ── 分栏内的排序微调 ──
   “奶类”里用户期待看到牛奶、酸奶，而不是配方奶粉/蛋白粉。
   这些是特殊用途产品，在奶类分栏里降权（不改动全局评分）。 */
const SPECIAL_DAIRY_RX = /(配方奶粉|蛋白粉|奶片|奶昔|奶酥|炼乳|奶皮|奶豆腐|奶疙瘩|奶酪|乳酪|奶油|黄油|冰淇淋|雪糕)/;

export function slotScore(f, goal) {
  let s = f.score + produceBonus(f, foodType(f));
  if (slotOf(f) === 'dairy' && SPECIAL_DAIRY_RX.test(f.name)) s -= 80;
  return s;
}

/* ── 推荐分桶 ──
   everydayOnly=true 时只保留日常食材（默认），false 时返回全部。 */
export function recommend(foods, goal, everydayOnly = true) {
  const buckets = { protein: [], veg: [], fruit: [], staple: [] };
  for (const f of foods) {
    if (f.kcal == null && f.protein == null && f.fiber == null) continue;
    const t = foodType(f);
    if (t === 'fat') continue;                       // 油脂不作为推荐食材
    if (everydayOnly && !isEveryday(f)) continue;

    const e = Object.assign({}, f, { type: t, everyday: isEveryday(f) });
    const d = derive(e);
    e.pros = d.pros; e.warns = d.warns; e.notes = d.notes;
    e.score = score(f, goal);
    e.slot = slotOf(f);
    e.slotScore = slotScore(e, goal);

    if (isProteinSource(f)) buckets.protein.push(e);
    else if (isVeg(f)) buckets.veg.push(e);
    else if (isFruit(f)) buckets.fruit.push(e);
    else if (isStaple(f)) buckets.staple.push(e);
  }
  for (const k in buckets) {
    buckets[k].sort((a, b) => (b.slotScore ?? b.score) - (a.slotScore ?? a.score)
      || (b.protein || 0) - (a.protein || 0));
    buckets[k] = dedupeVariants(buckets[k]);
  }
  return buckets;
}

/* ── BMI / 能量目标 ── */
export function computeProfile({ sex, height, weight, age, activity, goal }) {
  const m = height / 100;
  const bmi = weight / (m * m);
  let bmiTag, bmiAdvice, bmiClass;
  if (bmi < 18.5) {
    bmiClass = 'low'; bmiTag = '偏瘦';
    bmiAdvice = '体重偏低。建议优先保证总热量与蛋白质摄入，增重期不宜过度限制主食。';
  } else if (bmi < 24) {
    bmiClass = 'normal'; bmiTag = '正常';
    bmiAdvice = '体重在健康范围内。重点关注蛋白质摄入量与饮食品质，而非单纯控热量。';
  } else if (bmi < 28) {
    bmiClass = 'over'; bmiTag = '超重';
    bmiAdvice = '体重超出健康范围。建议在保证蛋白质的前提下适度控制总热量，并增加膳食纤维。';
  } else {
    bmiClass = 'obese'; bmiTag = '肥胖';
    bmiAdvice = '建议在专业指导下减重。优先减少高钠、高脂、高热量密度食物，避免极端节食。';
  }

  const bmr = sex === 'male'
    ? 10 * weight + 6.25 * height - 5 * age + 5
    : 10 * weight + 6.25 * height - 5 * age - 161;
  const tdee = bmr * activity;
  let targetKcal, kcalNote;
  if (goal === 'cut') { targetKcal = tdee * 0.8; kcalNote = '减脂：约为每日消耗的 80%（温和缺口，保留肌肉）。'; }
  else { targetKcal = tdee * 1.1; kcalNote = '增肌：约为每日消耗的 110%（小幅盈余，减少脂肪堆积）。'; }
  if (bmiClass === 'low' && goal === 'cut') {
    kcalNote += ' ⚠ 你的 BMI 已偏低，不建议继续减脂，请优先考虑增重或维持。';
  }
  /* 蛋白质：减脂期提高蛋白以保住肌肉（1.8–2.0 g/kg）；
     增肌期 1.6 g/kg 偏低，且会让剩余热量过多地压在碳水/脂肪上，
     与主流建议（1.6–2.2 g/kg）和实际可执行的饮食都不符，故取 1.8。 */
  const proteinPerKg = 1.8;
  const split = goal === 'cut' ? { p: 0.32, f: 0.26, c: 0.42 } : { p: 0.28, f: 0.27, c: 0.45 };
  return {
    bmi, bmiTag, bmiAdvice, bmiClass, bmr, tdee, targetKcal, kcalNote,
    proteinTarget: weight * proteinPerKg, proteinPerKg,
    carbG: targetKcal * split.c / 4, fatG: targetKcal * split.f / 9, split
  };
}

/* ════════════ 食物搜索 ════════════
   纯函数，便于 Node 测试。评分规则：
     完全等于关键词           100
     以关键词开头              80
     基础名（去括号）等于关键词  70
     包含关键词                50
     拼音首字母匹配            30
   同分时更短的名称优先（“鸡蛋”排在“鸡蛋黄粉”前）。 */

/* 从名称生成搜索形式。注意必须同时剥掉圆括号和方括号：
   数据里常见「菠菜（鲜）［赤根菜］」这种双重写法，
   只剥圆括号会留下「菠菜［赤根菜］」，导致与「菠菜」无法全等匹配。 */
const BRACKET_RE = /[（(\[［][^）)\]］]*[）)\]］]/g;

function searchForms(name) {
  const full = name.replace(/\s+/g, '');
  const base = full.replace(BRACKET_RE, '').trim() || full;
  const aliases = [...name.matchAll(/[\[［]([^\]］]+)[\]］]/g)]
    .flatMap(m => m[1].split(/[，,、]/))
    .map(s => s.trim()).filter(Boolean);
  return { base, aliases, full };
}

/* ── 同义词归一 ──
   用户习惯的说法与数据里的学名不一致，先做替换再匹配。
   例：数据里是「鸡胸脯肉」，用户会搜「鸡胸肉」。 */
const SYNONYMS = [
  [/胸肉/g, '胸脯肉'], [/鸡胸(?!脯)/g, '鸡胸脯'],
  [/猪里脊|里肌肉?/g, '里脊'],
  [/土豆/g, '马铃薯'], [/红薯|地瓜|山芋/g, '甘薯'],
  [/西红柿/g, '番茄'], [/花菜|菜花/g, '花椰菜'],
  [/包菜|卷心菜|圆白菜/g, '甘蓝'],
  [/猕猴桃/g, '猕猴桃'], [/圣女果/g, '樱桃番茄'],
  [/三文鱼/g, '鲑鱼'], [/金枪鱼/g, '金枪鱼'],
  [/鸡子|鸡蛋/g, '鸡蛋']
];

export function normalizeQuery(raw) {
  let q = String(raw || '').replace(/\s+/g, '').trim().toLowerCase();
  for (const [re, to] of SYNONYMS) q = q.replace(re, to);
  return q;
}

/* 生鲜主条目优先：括号越多、越是“代表值/罐头/脱水/粉”等加工形态，排名越靠后。
   这样搜「苹果」会先给出生鲜苹果，而不是苹果罐头。 */
const PROCESSED_RX = /脱水|罐头|罐装|干$|粉$|汁|酱|脯|蜜饯|果酱|浓缩|冷冻|速冻|烤|炸|腌|熏|卤/;
const FRESH_RX = /（鲜|\(鲜|鲜）|（生|\(生|活/;

function formPenalty(food) {
  let pen = 0;
  /* 「（代表值）」是该条目的总括行，应当优先 */
  const isRepresentative = /代表值/.test(food.name);
  const parens = (food.name.match(/[（(]/g) || []).length;
  pen += parens * 7;
  if (/[\[［]/.test(food.name)) pen += 5;      // 带一堆别名，多为冷门品种
  if (isRepresentative) pen -= 22;
  if (PROCESSED_RX.test(food.name)) pen += 18;
  if (FRESH_RX.test(food.name)) pen -= 14;     // 鲜品优先于同名加工品
  return pen;
}

/* 匹配优先级（档位差远大于档内微调，保证语义顺序不会被微调翻转）：
     1. 名称与关键词完全一致          （搜“菠菜” → 菠菜）
     2. 基础名一致 / 别名一致 / 基础名前缀（搜“菠菜” → 菠菜（脱水））
     3. 名称以关键词开头
     4. 名称包含关键词
     5. 别名包含
     6. 拼音首字母
   档内再用「形态惩罚 + 位置 + 长度」排序。 */
const TIER = { exact: 1000, base: 800, prefix: 600, contains: 400, aliasContains: 300, pinyin: 200 };

export function scoreMatch(food, q) {
  if (!q) return 0;
  const { base, aliases, full } = searchForms(food.name);
  let tier = 0;
  if (full === q) tier = TIER.exact;
  else if (base === q) tier = TIER.base;
  else if (aliases.some(a => a === q)) tier = TIER.base;
  else if (base.startsWith(q)) tier = TIER.base - 40;      // 前缀略低于全等
  else if (aliases.some(a => a.startsWith(q))) tier = TIER.base - 80;
  else if (full.startsWith(q)) tier = TIER.prefix;
  else if (full.includes(q)) tier = TIER.contains;
  else if (aliases.some(a => a.includes(q))) tier = TIER.aliasContains;
  else if (pinyinInitials(food.name).startsWith(q)) tier = TIER.pinyin;
  if (tier === 0) return 0;

  /* 档内微调（幅度 < 档位间距，不会跨档翻转） */
  let adj = 0;
  const pos = full.indexOf(q);
  if (pos > 0) adj -= Math.min(pos * 2, 20);
  adj -= Math.min(food.name.length, 20) * 0.8;
  adj -= formPenalty(food);
  return tier + adj;
}

/* 极简拼音首字母（覆盖常见食物用字），仅用于让“jxr”能搜到“鸡胸肉”。
   不追求完整拼音表，查不到就返回空串，不影响中文搜索。 */
const PY = {
  鸡: 'j', 鸭: 'y', 鹅: 'e', 猪: 'z', 牛: 'n', 羊: 'y', 鱼: 'y', 虾: 'x', 蟹: 'x',
  蛋: 'd', 奶: 'n', 豆: 'd', 米: 'm', 面: 'm', 菜: 'c', 瓜: 'g', 果: 'g', 肉: 'r',
  胸: 'x', 腿: 't', 排: 'p', 里: 'l', 脊: 'j', 肝: 'g', 心: 'x', 血: 'x', 皮: 'p',
  脯: 'p', 翅: 'c', 蹄: 't', 骨: 'g', 舌: 's', 耳: 'e', 脑: 'n', 肠: 'c', 肚: 'd',
  白: 'b', 红: 'h', 黄: 'h', 青: 'q', 黑: 'h', 紫: 'z', 绿: 'l', 花: 'h', 叶: 'y',
  根: 'g', 茎: 'j', 薯: 's', 芋: 'y', 葱: 'c', 蒜: 's', 姜: 'j', 椒: 'j', 茄: 'q',
  笋: 's', 蘑: 'm', 菇: 'g', 带: 'd', 海: 'h', 苹: 'p', 香: 'x', 蕉: 'j', 橙: 'c',
  橘: 'j', 梨: 'l', 桃: 't', 枣: 'z', 葡: 'p', 萄: 't', 莓: 'm', 核: 'h', 仁: 'r',
  生: 's', 油: 'y', 盐: 'y', 糖: 't', 粉: 'f', 干: 'g', 鲜: 'x', 熟: 's', 罐: 'g',
  头: 't', 全: 'q', 脱: 't', 脂: 'z', 酸: 's', 甜: 't', 咸: 'x', 苦: 'k', 辣: 'l',
  萝: 'l', 卜: 'b', 土: 't', 马: 'm', 铃: 'l', 玉: 'y', 麦: 'm', 燕: 'y', 荞: 'q',
  粱: 'l', 粟: 's', 薏: 'y', 芡: 'q', 莲: 'l', 藕: 'o', 菌: 'j', 藻: 'z', 苔: 't',
  芹: 'q', 韭: 'j', 菠: 'b', 芦: 'l'
};

export function pinyinInitials(name) {
  let out = '';
  for (const ch of name) {
    if (PY[ch]) out += PY[ch];
    else if (/[a-zA-Z0-9]/.test(ch)) out += ch.toLowerCase();
  }
  return out;
}

/* 搜索主入口：返回 { foods, total, query } */
export function searchFoods(foods, rawQuery, opts = {}) {
  const raw = String(rawQuery || '').replace(/\s+/g, '').trim().toLowerCase();
  if (!raw) return { foods: [], total: 0, query: '' };
  const q = normalizeQuery(raw);
  const limit = opts.limit || 60;

  const scored = [];
  for (const f of foods) {
    /* 同义词归一后再匹配；同时也用原词匹配一次取较高分 */
    const s = Math.max(scoreMatch(f, q), scoreMatch(f, raw));
    if (s > 0) scored.push({ f, s });
  }
  scored.sort((a, b) => b.s - a.s || (a.f.name.length - b.f.name.length));
  const total = scored.length;
  return { foods: scored.slice(0, limit).map(x => x.f), total, query: raw };
}

/* 搜索建议：按大类返回数量，便于用户判断该换什么词 */
export function searchFacets(results) {
  const byCat = {};
  for (const f of results) byCat[f.cat] = (byCat[f.cat] || 0) + 1;
  return Object.entries(byCat).sort((a, b) => b[1] - a[1]);
}
