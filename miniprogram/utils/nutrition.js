// 计算规则与 食光 网页版一致：
// 热量 = 碳水×4 + 蛋白质×4 + 脂肪×9；有效蛋白 = 包装蛋白质 × 折算比例（自定义估算，不代表实际吸收率）

const CATEGORIES = ['主食', '肉类', '蛋类', '蔬菜', '水果', '豆类及豆制品', '奶制品', '其他']
const MEALS = ['第一餐', '第二餐', '第三餐', '加餐']
// 套用食谱时各餐默认时间
const MEAL_TIMES = { 第一餐: '08:00', 第二餐: '12:00', 第三餐: '18:00', 加餐: '15:30' }
const MAX_GRAMS = 10000

function defaultFactor(food) {
  if (food.category === '蔬菜' || food.category === '水果') return 0.5
  if (['肉类', '蛋类', '奶制品'].indexOf(food.category) >= 0) return 1
  if (/^(鸡蛋|鸭蛋|鹌鹑蛋)([（(]|$)/.test(food.name || '')) return 1
  return 0.8
}

function kcalPer100(food) {
  return food.carbs * 4 + food.protein * 4 + food.fat * 9
}

function per100(food) {
  return {
    kcal: kcalPer100(food),
    carbs: food.carbs,
    protein: food.protein,
    effective: food.protein * food.factor,
    fat: food.fat
  }
}

function forGrams(food, grams) {
  const r = grams / 100
  const p = per100(food)
  return { kcal: p.kcal * r, carbs: p.carbs * r, protein: p.protein * r, effective: p.effective * r, fat: p.fat * r }
}

function empty() {
  return { kcal: 0, carbs: 0, protein: 0, effective: 0, fat: 0 }
}

function add(a, b) {
  return {
    kcal: a.kcal + b.kcal,
    carbs: a.carbs + b.carbs,
    protein: a.protein + b.protein,
    effective: a.effective + b.effective,
    fat: a.fat + b.fat
  }
}

// portions: [{ grams, food: { carbs, protein, fat, factor } }]
function totals(portions) {
  return portions.reduce((acc, p) => add(acc, forGrams(p.food, p.grams)), empty())
}

function round(n, digits) {
  const m = Math.pow(10, digits || 0)
  return Math.round(n * m) / m
}

// 页面显示用：全部取整
function display(t) {
  return {
    kcal: round(t.kcal),
    carbs: round(t.carbs),
    protein: round(t.protein),
    effective: round(t.effective),
    fat: round(t.fat)
  }
}

// 营养圆环：按热量占比分三段（碳水、蛋白质、脂肪），没有记录时只画底色
function ringStyle(t) {
  const c = t.carbs * 4, p = t.protein * 4, f = t.fat * 9
  const sum = c + p + f
  if (!(sum > 0)) return 'background: var(--line);'
  const a = round(c / sum * 360, 1), b = round((c + p) / sum * 360, 1)
  return 'background: conic-gradient(var(--gold) 0 ' + a + 'deg, var(--gold-soft) ' + a + 'deg ' + b + 'deg, var(--line-strong) ' + b + 'deg 360deg);'
}

// 1个（50克）/ 120克
function quantityText(portion) {
  const f = portion.food
  if (portion.unit && portion.unit !== '克' && f.servingGrams) {
    return round(portion.grams / f.servingGrams, 1) + portion.unit + '（' + round(portion.grams, 1) + '克）'
  }
  return round(portion.grams, 1) + '克'
}

module.exports = {
  CATEGORIES, MEALS, MEAL_TIMES, MAX_GRAMS,
  defaultFactor, kcalPer100, per100, forGrams, empty, add, totals, round, display, quantityText, ringStyle
}
