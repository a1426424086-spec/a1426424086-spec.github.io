const store = require('../../utils/store')
const N = require('../../utils/nutrition')

function foodList(foods, kw, cat) {
  return foods
    .filter(f => (cat === '全部' || f.category === cat) && (!kw || f.name.indexOf(kw) >= 0))
    .map(f => {
      const p = N.display(N.per100(f))
      return {
        id: f.id,
        name: f.name,
        nameParts: f.name.split(/(\d+(?:\.\d+)?)/),
        category: f.category,
        badge: N.badge(f.category),
        kcal: p.kcal,
        carbs: N.round(f.carbs, 1),
        protein: N.round(f.protein, 1),
        fat: N.round(f.fat, 1),
        factor: Math.round(f.factor * 100),
        servingUnit: f.servingUnit || '',
        servingGrams: f.servingGrams || 0,
        serving: f.servingUnit ? '每' + f.servingUnit + f.servingGrams + '克' : ''
      }
    })
}

Page({
  data: {
    // 好物推荐首版不上线；恢复时改 true，并把 pages/goods/index 加回 app.json、去掉 project.config.json 里的打包排除
    showGoods: false,
    keyword: '',
    category: '全部',
    categories: ['全部'].concat(N.CATEGORIES),
    list: [],
    flashId: '',
    total: 0
  },

  onLoad() {
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
    clearTimeout(this.flashTimer)
    this.setData({ flashId: '' })
    this.saveRenderCache()
  },

  // 用当前真实内容生成缓存，下次冷启动首次打开时先显示全部食材的静止画面。
  saveRenderCache() {
    if (!this.renderReady || typeof this.setInitialRenderingCache !== 'function') return
    const sig = this.lastSig
    if (!sig || sig === this.cacheSig) return
    const foods = store.getFoods()
    this.setInitialRenderingCache({
      keyword: '',
      category: '全部',
      categories: this.data.categories,
      list: foodList(foods, '', '全部'),
      total: foods.length,
      showGoods: this.data.showGoods,
      flashId: ''
    })
    this.cacheSig = sig
  },

  refresh() {
    const kw = this.data.keyword.trim()
    const cat = this.data.category
    const foods = store.getFoods()
    const list = foodList(foods, kw, cat)
    const sig = JSON.stringify([kw, cat, list])
    if (sig === this.lastSig) return
    this.lastSig = sig
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
