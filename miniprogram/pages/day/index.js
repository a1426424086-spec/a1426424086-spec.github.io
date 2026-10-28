const store = require('../../utils/store')
const N = require('../../utils/nutrition')
const D = require('../../utils/date')

function byTime(a, b) {
  return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
}

Page({
  data: {
    date: '',
    today: '',
    isToday: true,
    title: '今日配餐',
    totalsLabel: '今日营养',
    dateText: '',
    week: '',
    totals: N.display(N.empty()),
    meals: [],
    count: 0
  },

  onShow() {
    const app = getApp()
    let date = this.data.date || D.today()
    if (app.globalData.pendingDate) {
      date = app.globalData.pendingDate
      app.globalData.pendingDate = ''
    }
    this.load(date)
  },

  load(date) {
    const today = D.today()
    const day = store.getDay(date)
    this.portions = day.portions
    const meals = N.MEALS.map((name, i) => {
      const list = day.portions.filter(p => p.meal === name).sort(byTime)
      return {
        name,
        index: '0' + (i + 1),
        kcal: N.round(N.totals(list).kcal),
        items: list.map(p => ({
          id: p.id,
          name: p.food.name,
          time: p.time,
          qty: N.quantityText(p),
          kcal: N.round(N.forGrams(p.food, p.grams).kcal)
        }))
      }
    })
    const isToday = date === today
    const isFuture = date > today
    this.setData({
      date,
      today,
      isToday,
      title: isToday ? '今日配餐' : isFuture ? '计划配餐' : '当日配餐',
      totalsLabel: isToday ? '今日营养' : isFuture ? '计划营养' : '当日营养',
      dateText: D.slash(date),
      week: D.weekday(date),
      totals: N.display(N.totals(day.portions)),
      meals,
      count: day.portions.length
    })
  },

  prevDay() {
    this.load(D.addDays(this.data.date, -1))
  },

  nextDay() {
    this.load(D.addDays(this.data.date, 1))
  },

  onPickDate(e) {
    this.load(e.detail.value)
  },

  backToday() {
    this.load(D.today())
  },

  addTo(e) {
    const meal = e.currentTarget.dataset.meal
    wx.navigateTo({ url: '/pages/pick/index?date=' + this.data.date + '&meal=' + encodeURIComponent(meal) })
  },

  onTimeChange(e) {
    this.safe(() => store.updatePortion(this.data.date, e.currentTarget.dataset.id, { time: e.detail.value }))
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id
    const p = this.portions.find(x => x.id === id)
    if (!p) return
    const others = N.MEALS.filter(m => m !== p.meal)
    wx.showActionSheet({
      itemList: ['修改用量'].concat(others.map(m => '移到' + m), ['删除']),
      success: res => {
        const i = res.tapIndex
        if (i === 0) this.editAmount(p)
        else if (i <= others.length) this.safe(() => store.updatePortion(this.data.date, id, { meal: others[i - 1] }))
        else this.safe(() => store.removePortion(this.data.date, id))
      }
    })
  },

  editAmount(p) {
    const byUnit = p.unit !== '克' && p.food.servingGrams
    const current = byUnit ? N.round(p.grams / p.food.servingGrams, 2) : N.round(p.grams, 1)
    wx.showModal({
      title: p.food.name,
      editable: true,
      placeholderText: byUnit ? '数量（' + p.unit + '）' : '克数',
      content: String(current),
      success: res => {
        if (!res.confirm) return
        const v = parseFloat(res.content)
        const grams = byUnit ? v * p.food.servingGrams : v
        if (!(grams > 0 && grams <= N.MAX_GRAMS)) {
          wx.showToast({ title: '重量须大于0，不超过10,000克', icon: 'none' })
          return
        }
        this.safe(() => store.updatePortion(this.data.date, p.id, { grams: N.round(grams, 1) }))
      }
    })
  },

  saveAsRecipe() {
    wx.showModal({
      title: '存入食谱夹',
      editable: true,
      placeholderText: '食谱名称，不填则自动命名',
      success: res => {
        if (!res.confirm) return
        const r = store.recipeFromDay(this.data.date, (res.content || '').trim())
        wx.showToast({ title: r.ok ? '已加入食谱夹' : r.error, icon: r.ok ? 'success' : 'none' })
      }
    })
  },

  clearDay() {
    wx.showModal({
      title: '清空这一天的记录？',
      content: '只清空 ' + D.short(this.data.date) + '，其他记录不变。',
      confirmText: '清空',
      confirmColor: '#d9534f',
      success: res => {
        if (res.confirm) this.safe(() => store.clearDay(this.data.date))
      }
    })
  },

  // 写入后刷新；存储失败时提示
  safe(fn) {
    try {
      fn()
    } catch (e) {
      wx.showToast({ title: '保存失败，请检查存储空间', icon: 'none' })
    }
    this.load(this.data.date)
  }
})
