const store = require('../../utils/store')
const N = require('../../utils/nutrition')
const D = require('../../utils/date')

Page({
  data: {
    id: '',
    src: 'mine',
    name: '',
    totals: N.display(N.empty()),
    meals: [],
    date: '',
    missing: false
  },

  onLoad(q) {
    const src = q.src === 'ref' ? 'ref' : 'mine'
    const recipe = store.findRecipe(q.id, src)
    if (!recipe) {
      this.setData({ missing: true })
      return
    }
    const portions = store.recipePortions(recipe, src === 'mine')
    const notes = recipe.mealNotes || []
    const meals = N.MEALS.map(m => {
      const list = portions.filter(p => p.meal === m)
      const note = notes.find(n => n.meal === m) || {}
      return {
        name: m,
        title: note.title || '',
        note: note.note || '',
        kcal: N.round(N.totals(list).kcal),
        items: list.map((p, i) => ({
          key: m + i,
          name: p.food.name,
          qty: N.quantityText(p),
          kcal: N.round(N.forGrams(p.food, p.grams).kcal)
        }))
      }
    }).filter(m => m.items.length)
    const name = src === 'ref' ? '参考食谱 ' + recipe.name : recipe.name
    wx.setNavigationBarTitle({ title: name })
    this.setData({
      id: recipe.id,
      src,
      name,
      totals: N.display(N.totals(portions)),
      meals,
      date: D.today()
    })
  },

  onPickDate(e) {
    const date = e.detail.value
    this.setData({ date })
    const existing = store.getDay(date).portions.length
    if (!existing) {
      this.apply(date)
      return
    }
    wx.showModal({
      title: '替换这一天的配餐？',
      content: '将替换 ' + D.short(date) + ' 已有的 ' + existing + ' 项记录，其他日期不变。',
      confirmText: '替换',
      success: r => {
        if (r.confirm) this.apply(date)
      }
    })
  },

  apply(date) {
    let res
    try {
      res = store.applyRecipe(this.data.id, this.data.src, date)
    } catch (e) {
      res = { ok: false, error: '保存失败，请检查存储空间' }
    }
    if (!res.ok) {
      wx.showToast({ title: res.error, icon: 'none' })
      return
    }
    wx.showToast({ title: '已用于' + D.short(date), icon: 'success' })
    setTimeout(() => getApp().openDay(date), 600)
  },

  copy() {
    const res = store.copyReference(this.data.id)
    wx.showToast({ title: res.ok ? '已存入我的食谱' : res.error, icon: res.ok ? 'success' : 'none' })
  },

  remove() {
    wx.showModal({
      title: '删除这份食谱？',
      content: '每日记录不变。',
      confirmText: '删除',
      confirmColor: '#d9534f',
      success: r => {
        if (!r.confirm) return
        store.deleteRecipe(this.data.id)
        wx.showToast({ title: '食谱已删除', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 500)
      }
    })
  }
})
