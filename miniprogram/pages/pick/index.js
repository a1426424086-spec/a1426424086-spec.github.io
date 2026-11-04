const store = require('../../utils/store')
const N = require('../../utils/nutrition')
const D = require('../../utils/date')

// 各餐的时段（小时，左闭右开）；今天且现在落在该餐时段内，就记现在的时间
const MEAL_HOURS = { 第一餐: [5, 11], 第二餐: [11, 16], 第三餐: [16, 22] }

function autoTime(date, meal) {
  if (date !== D.today()) return N.MEAL_TIMES[meal]
  if (meal === '加餐') return D.nowTime()
  const h = new Date().getHours()
  const r = MEAL_HOURS[meal]
  return r && h >= r[0] && h < r[1] ? D.nowTime() : N.MEAL_TIMES[meal]
}

function foodList(source, kw, cat, usage) {
  let foods = source.filter(f => (cat === '全部' || f.category === cat) && (!kw || f.name.indexOf(kw) >= 0))
  if (!kw && cat === '全部' && usage) {
    const u = usage
    foods = foods.map((f, i) => ({ f, i })).sort((a, b) => ((u[b.f.id] || 0) - (u[a.f.id] || 0)) || (a.i - b.i)).map(x => x.f)
  }
  return foods.map(f => ({
    id: f.id,
    name: f.name,
    nameParts: f.name.split(/(\d+(?:\.\d+)?)/),
    category: f.category,
    badge: N.badge(f.category),
    kcal: N.round(N.kcalPer100(f)),
    c: N.round(f.carbs, 1),
    p: N.round(f.protein, 1),
    fa: N.round(f.fat, 1),
    servingUnit: f.servingUnit || '',
    servingGrams: f.servingGrams || 0,
    serving: f.servingUnit ? '每' + f.servingUnit + '约' + f.servingGrams + '克' : ''
  }))
}

Page({
  data: {
    date: '',
    meal: '',
    time: '',
    keyword: '',
    category: '全部',
    categories: ['全部'].concat(N.CATEGORIES),
    list: [],
    ready: false,
    flashId: '',
    sel: null,
    sheetShow: false,
    unit: '克',
    qty: '',
    qtyEditing: false, kbRaise: 0,
    qtyHint: '克',
    preview: null,
    added: 0, popKey: 0, okId: ''
  },

  onLoad(q) {
    const date = D.isValid(q.date) ? q.date : D.today()
    // 首页用 encodeURIComponent 传餐次，这里收到的仍是编码串，先解码
    let m = q.meal || ''
    try {
      m = decodeURIComponent(m)
    } catch (e) {}
    const meal = N.MEALS.indexOf(m) >= 0 ? m : N.MEALS[0]
    const time = autoTime(date, meal)
    this.setData({ date, meal, time })
    const recipe = q.recipe && store.findRecipe(q.recipe, 'mine')
    if (recipe) {
      this.recipeId = q.recipe
      this.setData({ recipeName: recipe.name })
      wx.setNavigationBarTitle({ title: recipe.name + ' · ' + meal })
    } else {
      wx.setNavigationBarTitle({ title: meal + ' · ' + D.short(date) })
    }
    // 最近 14 天每种食物出现的次数，用来把常吃的排在前面
    const usage = {}
    for (let i = 0; i < 14; i++) {
      store.getDay(D.addDays(D.today(), -i)).portions.forEach(p => {
        usage[p.foodId] = (usage[p.foodId] || 0) + 1
      })
    }
    this.usage = usage
    this.refresh()
  },

  onShow() {
    this.refresh()
    // 从食材编辑回来：刚保存的那一行闪一下并滚到可见
    const app = getApp(), id = app.globalData.flashFoodId
    if (id) {
      app.globalData.flashFoodId = ''
      this.setData({ flashId: id }, () => {
        wx.pageScrollTo({ selector: '#food-' + id, offsetTop: -160, duration: 300 })
        clearTimeout(this.flashTimer)
        this.flashTimer = setTimeout(() => this.setData({ flashId: '' }), 1300)
      })
    }
  },

  onReady() {
    this.renderReady = true
    this.saveRenderCache()
  },

  onHide() {
    this.saveRenderCache()
  },

  onUnload() {
    clearTimeout(this.sheetTimer)
    clearTimeout(this.okTimer)
    clearTimeout(this.flashTimer)
    this.setData({ flashId: '' })
    this.saveRenderCache()
  },

  // 用当前真实内容生成缓存，下次冷启动首次打开时先显示全部食材，不保留弹层和动画。
  saveRenderCache() {
    if (!this.renderReady || typeof this.setInitialRenderingCache !== 'function') return
    const sig = this.lastSig
    if (!sig || sig === this.cacheSig) return
    this.setInitialRenderingCache({
      date: this.data.date,
      meal: this.data.meal,
      time: this.data.time,
      recipeName: this.data.recipeName || '',
      keyword: '',
      category: '全部',
      categories: this.data.categories,
      list: foodList(store.getFoods(), '', '全部', this.usage),
      ready: true,
      added: 0,
      sel: null,
      sheetShow: false,
      qtyEditing: false,
      kbRaise: 0,
      unit: '克',
      qty: '',
      qtyHint: '克',
      preview: null,
      okId: '',
      flashId: '',
      popKey: 0
    })
    this.cacheSig = sig
  },

  refresh() {
    const kw = this.data.keyword.trim()
    const cat = this.data.category
    this.foods = store.getFoods()
    const list = foodList(this.foods, kw, cat, this.usage)
    const sig = JSON.stringify([kw, cat, list])
    if (sig === this.lastSig) return
    this.lastSig = sig
    this.setData({ list, ready: true })
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.refresh()
  },

  onCategory(e) {
    this.setData({ category: e.currentTarget.dataset.c })
    this.refresh()
  },

  onSelect(e) {
    clearTimeout(this.sheetTimer)
    const food = this.foods.find(f => f.id === e.currentTarget.dataset.id)
    if (!food) return
    this.food = food
    this.setData({
      sel: { name: food.name, per100: N.display(N.per100(food)), note: food.weight || '', nameParts: food.name.split(/(\d+(?:\.\d+)?)/), noteParts: (food.weight || '').split(/(\d+(?:\.\d+)?)/) },
      unit: '克',
      qty: food.servingGrams ? String(N.round(food.servingGrams)) : '100',
      qtyEditing: false
    })
    this.updatePreview()
    this.setData({ sheetShow: false })
    this.sheetTimer = setTimeout(() => this.setData({ sheetShow: true }), 20)
  },

  closeSheet() {
    clearTimeout(this.sheetTimer)
    this.setData({ sheetShow: false, kbRaise: 0 })
    this.sheetTimer = setTimeout(() => this.setData({ sel: null }), 320)
  },

  beginQtyEdit() { this.setData({ qtyEditing: true }) },
  endQtyEdit() { this.setData({ qtyEditing: false, kbRaise: 0 }) },
  // 键盘弹出：面板上移，让数字和实时营养那一行露在键盘上方
  onKbHeight(e) {
    const h = e.detail.height || 0
    if (!h) { this.setData({ kbRaise: 0 }); return }
    this.createSelectorQuery().select('.dsheet.show').boundingClientRect().select('.dsheet.show .sh-live').boundingClientRect().exec(res => {
      const sheet = res && res[0], live = res && res[1]
      const below = sheet && live ? sheet.bottom - live.bottom : 0
      this.setData({ kbRaise: Math.max(0, Math.round(h - below + 12)) })
    })
  },

  onQty(e) {
    this.setData({ qty: e.detail.value })
    this.updatePreview()
  },

  stepUp() { this.stepQty(1) },
  stepDown() { this.stepQty(-1) },
  // 克：50 以下每次 5 克，否则 10 克
  stepQty(direction) {
    this.setData({ qtyEditing: false, kbRaise: 0 })
    const min = 5
    const max = N.MAX_GRAMS
    const current = parseFloat(this.data.qty) || min
    const step = (current - (direction < 0 ? 1 : 0)) < 50 ? 5 : 10
    const next = N.round(Math.min(max, Math.max(min, current + direction * step)), 2)
    this.setData({ qty: String(next) })
    this.updatePreview()
  },

  grams() {
    const v = parseFloat(this.data.qty)
    if (!(v > 0)) return 0
    return v
  },

  updatePreview() {
    const g = this.grams()
    this.setData({
      qtyHint: '克',
      preview: g > 0 && g <= N.MAX_GRAMS
        ? Object.assign({ grams: N.round(g, 1) }, N.display(N.forGrams(this.food, g)))
        : null
    })
  },

  confirm() {
    if (!this.data.sheetShow) return
    const g = this.grams()
    if (!(g > 0 && g <= N.MAX_GRAMS)) {
      wx.showToast({ title: '重量须大于0，不超过10,000克', icon: 'none' })
      return
    }
    try {
      if (this.recipeId) {
        const res = store.addRecipePortion(this.recipeId, {
          food: this.food, meal: this.data.meal, grams: N.round(g, 1), unit: '克'
        })
        if (!res.ok) {
          wx.showToast({ title: res.error, icon: 'none' })
          return
        }
      } else {
        store.addPortion(this.data.date, {
          food: this.food,
          meal: this.data.meal,
          time: this.data.time,
          grams: N.round(g, 1),
          unit: '克'
        })
      }
    } catch (e) {
      wx.showToast({ title: '保存失败，请检查存储空间', icon: 'none' })
      return
    }
    this.closeSheet()
    this.setData({ added: this.data.added + 1, popKey: this.data.popKey + 1, okId: this.food.id })
    clearTimeout(this.okTimer)
    this.okTimer = setTimeout(() => this.setData({ okId: '' }), 900)
  },

  newFood() {
    wx.navigateTo({ url: '/pages/food-edit/index' })
  },

  done() {
    wx.navigateBack()
  }
})
