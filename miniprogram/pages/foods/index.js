const store = require('../../utils/store')
const N = require('../../utils/nutrition')

Page({
  data: {
    keyword: '',
    category: '全部',
    categories: ['全部'].concat(N.CATEGORIES),
    list: [],
    total: 0
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const kw = this.data.keyword.trim()
    const cat = this.data.category
    const foods = store.getFoods()
    const list = foods
      .filter(f => (cat === '全部' || f.category === cat) && (!kw || f.name.indexOf(kw) >= 0))
      .map(f => {
        const p = N.display(N.per100(f))
        return {
          id: f.id,
          name: f.name,
          category: f.category,
          kcal: p.kcal,
          carbs: N.round(f.carbs, 1),
          protein: N.round(f.protein, 1),
          fat: N.round(f.fat, 1),
          factor: Math.round(f.factor * 100),
          serving: f.servingUnit ? '每' + f.servingUnit + f.servingGrams + '克' : ''
        }
      })
    this.setData({ list, total: foods.length })
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.refresh()
  },

  onCategory(e) {
    this.setData({ category: e.currentTarget.dataset.c })
    this.refresh()
  },

  edit(e) {
    wx.navigateTo({ url: '/pages/food-edit/index?id=' + e.currentTarget.dataset.id })
  },

  add() {
    wx.navigateTo({ url: '/pages/food-edit/index' })
  },

  openGoods() {
    wx.navigateTo({ url: '/pages/goods/index' })
  }
})
