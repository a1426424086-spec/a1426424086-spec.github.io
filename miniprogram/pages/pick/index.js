const store = require('../../utils/store')
const N = require('../../utils/nutrition')
const D = require('../../utils/date')

Page({
  data: {
    date: '',
    meal: '',
    meals: N.MEALS,
    time: '',
    keyword: '',
    category: '全部',
    categories: ['全部'].concat(N.CATEGORIES),
    list: [],
    sel: null,
    units: [],
    unit: '克',
    qty: '',
    preview: null,
    added: 0
  },

  onLoad(q) {
    const date = D.isValid(q.date) ? q.date : D.today()
    const meal = N.MEALS.indexOf(q.meal) >= 0 ? q.meal : N.MEALS[0]
    const time = date === D.today() ? D.nowTime() : N.MEAL_TIMES[meal]
    this.setData({ date, meal, time })
    wx.setNavigationBarTitle({ title: '添加 · ' + D.short(date) })
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const kw = this.data.keyword.trim()
    const cat = this.data.category
    this.foods = store.getFoods()
    const list = this.foods
      .filter(f => (cat === '全部' || f.category === cat) && (!kw || f.name.indexOf(kw) >= 0))
      .map(f => ({
        id: f.id,
        name: f.name,
        nameParts: f.name.split(/(\d+(?:\.\d+)?)/),
        category: f.category,
        kcal: N.round(N.kcalPer100(f)),
        servingUnit: f.servingUnit || '',
        servingGrams: f.servingGrams || 0,
        serving: f.servingUnit ? '每' + f.servingUnit + '约' + f.servingGrams + '克' : ''
      }))
    this.setData({ list })
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
    const food = this.foods.find(f => f.id === e.currentTarget.dataset.id)
    if (!food) return
    this.food = food
    const hasUnit = !!food.servingUnit
    this.setData({
      sel: { name: food.name, per100: N.display(N.per100(food)), note: food.weight || '', nameParts: food.name.split(/(\d+(?:\.\d+)?)/), noteParts: (food.weight || '').split(/(\d+(?:\.\d+)?)/) },
      units: hasUnit ? [food.servingUnit, '克'] : ['克'],
      unit: hasUnit ? food.servingUnit : '克',
      qty: hasUnit ? '1' : '100'
    })
    this.updatePreview()
  },

  closeSheet() {
    this.setData({ sel: null })
  },

  onMeal(e) {
    const meal = e.currentTarget.dataset.m
    const patch = { meal }
    // 非今天的记录，换餐次时同时换成该餐默认时间
    if (this.data.date !== D.today()) patch.time = N.MEAL_TIMES[meal]
    this.setData(patch)
  },

  onTime(e) {
    this.setData({ time: e.detail.value })
  },

  onUnit(e) {
    const unit = e.currentTarget.dataset.u
    if (unit === this.data.unit) return
    const g = this.grams()
    const sg = this.food.servingGrams
    const qty = unit === '克' ? (g ? N.round(g, 1) : 100) : (g ? N.round(g / sg, 2) : 1)
    this.setData({ unit, qty: String(qty) })
    this.updatePreview()
  },

  onQty(e) {
    this.setData({ qty: e.detail.value })
    this.updatePreview()
  },

  grams() {
    const v = parseFloat(this.data.qty)
    if (!(v > 0)) return 0
    return this.data.unit === '克' ? v : v * this.food.servingGrams
  },

  updatePreview() {
    const g = this.grams()
    this.setData({
      preview: g > 0 && g <= N.MAX_GRAMS
        ? Object.assign({ grams: N.round(g, 1) }, N.display(N.forGrams(this.food, g)))
        : null
    })
  },

  confirm() {
    const g = this.grams()
    if (!(g > 0 && g <= N.MAX_GRAMS)) {
      wx.showToast({ title: '重量须大于0，不超过10,000克', icon: 'none' })
      return
    }
    try {
      store.addPortion(this.data.date, {
        food: this.food,
        meal: this.data.meal,
        time: this.data.time,
        grams: N.round(g, 1),
        unit: this.data.unit
      })
    } catch (e) {
      wx.showToast({ title: '保存失败，请检查存储空间', icon: 'none' })
      return
    }
    wx.showToast({ title: '已加入' + this.data.meal, icon: 'success' })
    this.setData({ sel: null, added: this.data.added + 1 })
  },

  newFood() {
    wx.navigateTo({ url: '/pages/food-edit/index' })
  },

  done() {
    wx.navigateBack()
  }
})
