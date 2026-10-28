// 本机存储（wx.setStorageSync）。每天一条记录单独存一个键，避免单键超过 1MB。
//   sg-meta            { version, createdAt }
//   sg-foods           食材库
//   sg-recipes         我的食谱
//   sg-dates           有记录的日期索引（升序）
//   sg-day:YYYY-MM-DD  { date, portions: [...] }
// 每条记录保存当时的食材营养快照：删除食材不影响已有记录；
// 修改食材只同步今天及以后的记录，过去的记录保持原样（与网页版一致）。

const N = require('./nutrition')
const D = require('./date')
const DEFAULT_FOODS = require('../data/foods')
const REFERENCE_RECIPES = require('../data/recipes')

const VERSION = 1
const KEY = { meta: 'sg-meta', foods: 'sg-foods', recipes: 'sg-recipes', dates: 'sg-dates' }
const LIMITS = { foods: 500, recipes: 200 }

function dayKey(date) {
  return 'sg-day:' + date
}

function get(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v === undefined || v === null ? fallback : v
  } catch (e) {
    return fallback
  }
}

// 写入失败会抛出，由页面提示
function set(key, value) {
  wx.setStorageSync(key, value)
}

function clone(o) {
  return JSON.parse(JSON.stringify(o))
}

function uid(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function init() {
  if (get(KEY.meta, null)) return
  set(KEY.foods, clone(DEFAULT_FOODS))
  set(KEY.recipes, [])
  set(KEY.dates, [])
  set(KEY.meta, { version: VERSION, createdAt: Date.now() })
}

/* ---------- 食材库 ---------- */

function snapshot(food) {
  const s = {
    name: food.name,
    category: food.category,
    carbs: food.carbs,
    protein: food.protein,
    fat: food.fat,
    factor: food.factor
  }
  if (food.servingGrams && food.servingUnit) {
    s.servingGrams = food.servingGrams
    s.servingUnit = food.servingUnit
  }
  return s
}

function getFoods() {
  return get(KEY.foods, [])
}

function getFood(id) {
  return getFoods().find(f => f.id === id) || null
}

function validMacro(n) {
  return typeof n === 'number' && isFinite(n) && n >= 0 && n <= 100
}

function validateFood(food, foods) {
  const name = (food.name || '').trim()
  if (!name) return '请填写食物名称'
  if (name.length > 40) return '名称不超过40个字'
  if (N.CATEGORIES.indexOf(food.category) < 0) return '请选择分类'
  if (!validMacro(food.carbs) || !validMacro(food.protein) || !validMacro(food.fat)) return '营养值须为0–100克'
  if (N.kcalPer100(food) > 1000) return '每100克计算热量不能超过1000千卡'
  if (!(typeof food.factor === 'number' && food.factor >= 0 && food.factor <= 1)) return '折算比例须为0–100%'
  if (food.servingUnit && !(food.servingGrams > 0 && food.servingGrams <= N.MAX_GRAMS)) return '请填写每' + food.servingUnit + '的克数'
  if (foods.some(f => f.id !== food.id && f.name.trim() === name)) return '名称重复，请改名或编辑已有食材'
  return ''
}

// 返回 { ok, error, food }
function saveFood(input) {
  const foods = getFoods()
  const food = Object.assign({}, input, { name: (input.name || '').trim() })
  if (!food.servingUnit) {
    delete food.servingUnit
    delete food.servingGrams
  }
  const error = validateFood(food, foods)
  if (error) return { ok: false, error }
  const idx = food.id ? foods.findIndex(f => f.id === food.id) : -1
  if (idx >= 0) {
    foods[idx] = food
  } else {
    if (foods.length >= LIMITS.foods) return { ok: false, error: '食材库已满，请先删除不用的食材' }
    food.id = uid('food')
    foods.unshift(food)
  }
  set(KEY.foods, foods)
  if (idx >= 0) syncFutureDays(food)
  return { ok: true, food }
}

function syncFutureDays(food) {
  const t = D.today()
  const snap = snapshot(food)
  listDates().filter(d => d >= t).forEach(date => {
    const day = getDay(date)
    let changed = false
    day.portions.forEach(p => {
      if (p.foodId === food.id) {
        p.food = snap
        if (p.unit !== '克' && !snap.servingUnit) p.unit = '克'
        changed = true
      }
    })
    if (changed) saveDay(day)
  })
}

function deleteFood(id) {
  set(KEY.foods, getFoods().filter(f => f.id !== id))
}

/* ---------- 好物推荐 ---------- */

function goodsFoodId(goods) {
  return 'goods-' + goods.id
}

function goodsFoodName(goods) {
  return goods.nutritionSource === 'example' ? goods.title + '（示例营养）' : goods.title
}

// 已导入：同 ID 或同名食品已在食材库
function isGoodsImported(goods, foods) {
  const id = goodsFoodId(goods)
  const name = goodsFoodName(goods)
  return (foods || getFoods()).some(f => f.id === id || f.name === name)
}

// 把推荐食品复制到食材库；已有则不覆盖用户改过的值
function importGoods(goods) {
  const foods = getFoods()
  if (isGoodsImported(goods, foods)) return { ok: false, error: '食材库里已有，未覆盖' }
  if (foods.length >= LIMITS.foods) return { ok: false, error: '食材库已满，请先删除不用的食材' }
  const n = goods.nutrition
  const food = {
    id: goodsFoodId(goods),
    name: goodsFoodName(goods),
    category: goods.category,
    carbs: n.carbs,
    protein: n.protein,
    fat: n.fat,
    factor: typeof n.factor === 'number' ? n.factor / 100 : N.defaultFactor({ category: goods.category, name: goods.title }),
    weight: '成品重量',
    note: goods.nutritionSource === 'example' ? '示例营养，非商品包装值' : '好物推荐导入，每100克营养按包装标签',
    url: goods.link
  }
  if (goods.servingGrams && goods.servingUnit) {
    food.servingGrams = goods.servingGrams
    food.servingUnit = goods.servingUnit
  }
  const error = validateFood(food, foods)
  if (error) return { ok: false, error }
  foods.unshift(food)
  set(KEY.foods, foods)
  return { ok: true, food }
}

/* ---------- 每日记录 ---------- */

function listDates() {
  return get(KEY.dates, [])
}

function getDay(date) {
  return get(dayKey(date), null) || { date, portions: [] }
}

function saveDay(day) {
  let dates = listDates()
  if (day.portions.length) {
    set(dayKey(day.date), day)
    if (dates.indexOf(day.date) < 0) {
      dates = dates.concat(day.date).sort()
      set(KEY.dates, dates)
    }
  } else {
    wx.removeStorageSync(dayKey(day.date))
    if (dates.indexOf(day.date) >= 0) set(KEY.dates, dates.filter(d => d !== day.date))
  }
}

// opts: { food, meal, time, grams, unit }
function addPortion(date, opts) {
  const day = getDay(date)
  const portion = {
    id: uid('p'),
    foodId: opts.food.id || '',
    meal: opts.meal,
    time: opts.time,
    grams: opts.grams,
    unit: opts.unit || '克',
    food: snapshot(opts.food)
  }
  day.portions.push(portion)
  saveDay(day)
  return portion
}

function updatePortion(date, id, patch) {
  const day = getDay(date)
  const p = day.portions.find(x => x.id === id)
  if (!p) return
  Object.assign(p, patch)
  saveDay(day)
}

function removePortion(date, id) {
  const day = getDay(date)
  day.portions = day.portions.filter(x => x.id !== id)
  saveDay(day)
}

function clearDay(date) {
  saveDay({ date, portions: [] })
}

/* ---------- 食谱 ---------- */

function getRecipes() {
  return get(KEY.recipes, [])
}

function getReferenceRecipes() {
  return REFERENCE_RECIPES
}

function findRecipe(id, src) {
  const list = src === 'ref' ? REFERENCE_RECIPES : getRecipes()
  return list.find(r => r.id === id) || null
}

// 食谱 portions 引用自带的 foods 快照
function recipePortions(recipe, preferLibrary) {
  const library = preferLibrary ? getFoods() : []
  return recipe.portions.map(p => {
    const food = library.find(f => f.id === p.foodId) || recipe.foods.find(f => f.id === p.foodId)
    return food ? { foodId: p.foodId, meal: p.meal, grams: p.grams, unit: p.unit || '克', food } : null
  }).filter(Boolean)
}

function saveRecipe(recipe) {
  const recipes = getRecipes()
  if (recipes.length >= LIMITS.recipes) return { ok: false, error: '食谱夹已满，请先删除不用的食谱' }
  const r = Object.assign(clone(recipe), { id: uid('recipe'), createdAt: Date.now() })
  recipes.unshift(r)
  set(KEY.recipes, recipes)
  return { ok: true, recipe: r }
}

function recipeFromDay(date, name) {
  const day = getDay(date)
  if (!day.portions.length) return { ok: false, error: '这一天还没有记录' }
  const foods = []
  const portions = day.portions.map(p => {
    const fid = p.foodId || uid('food')
    if (!foods.some(f => f.id === fid)) foods.push(Object.assign({ id: fid }, p.food))
    return { foodId: fid, grams: p.grams, meal: p.meal, unit: p.unit }
  })
  return saveRecipe({ name: name || D.short(date) + '配餐', group: '', portions, foods, mealNotes: [] })
}

function copyReference(id) {
  const ref = findRecipe(id, 'ref')
  if (!ref) return { ok: false, error: '食谱不存在' }
  return saveRecipe(Object.assign({}, ref, { name: '参考食谱 ' + ref.name, group: '' }))
}

function deleteRecipe(id) {
  set(KEY.recipes, getRecipes().filter(r => r.id !== id))
}

// 用食谱替换某一天的记录。我的食谱优先用食材库当前数值，已删食材用原数值；参考食谱用模板数值。
function applyRecipe(id, src, date) {
  const recipe = findRecipe(id, src)
  if (!recipe) return { ok: false, error: '食谱不存在' }
  const portions = recipePortions(recipe, src !== 'ref').map(p => ({
    id: uid('p'),
    foodId: p.foodId,
    meal: p.meal,
    time: N.MEAL_TIMES[p.meal] || '12:00',
    grams: p.grams,
    unit: p.unit !== '克' && p.food.servingUnit ? p.unit : '克',
    food: snapshot(p.food)
  }))
  saveDay({ date, portions })
  return { ok: true }
}

module.exports = {
  init, uid,
  getFoods, getFood, saveFood, deleteFood,
  isGoodsImported, importGoods,
  listDates, getDay, addPortion, updatePortion, removePortion, clearDay,
  getRecipes, getReferenceRecipes, findRecipe, recipePortions,
  recipeFromDay, copyReference, deleteRecipe, applyRecipe
}
