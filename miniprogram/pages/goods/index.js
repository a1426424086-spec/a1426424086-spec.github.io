const store = require('../../utils/store')
const N = require('../../utils/nutrition')
const GOODS = require('../../data/goods')

Page({
  data: {
    list: []
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const foods = store.getFoods()
    const list = GOODS.map(g => {
      const n = g.nutrition
      const factor = typeof n.factor === 'number' ? n.factor / 100 : N.defaultFactor({ category: g.category, name: g.title })
      const per100 = N.display(N.per100({ carbs: n.carbs, protein: n.protein, fat: n.fat, factor }))
      return {
        id: g.id,
        title: g.title,
        category: g.category,
        image: g.images[0],
        example: g.nutritionSource === 'example',
        serving: g.servingUnit ? '每' + g.servingUnit + g.servingGrams + '克' : '',
        per100,
        factor: Math.round(factor * 100),
        imported: store.isGoodsImported(g, foods)
      }
    })
    this.setData({ list })
  },

  // 小程序不能直接打开外部商品页，点图片复制链接
  openLink(e) {
    const g = GOODS.find(x => x.id === e.currentTarget.dataset.id)
    if (!g || !g.link) return
    wx.setClipboardData({
      data: g.link,
      success: () => wx.showToast({ title: '商品链接已复制，可在浏览器或抖音打开', icon: 'none' })
    })
  },

  preview(e) {
    const src = e.currentTarget.dataset.src
    wx.previewImage({ current: src, urls: [src] })
  },

  importOne(e) {
    const g = GOODS.find(x => x.id === e.currentTarget.dataset.id)
    if (!g) return
    let res
    try {
      res = store.importGoods(g)
    } catch (err) {
      res = { ok: false, error: '保存失败，请检查存储空间' }
    }
    wx.showToast({ title: res.ok ? '已导入食材库' : res.error, icon: res.ok ? 'success' : 'none' })
    this.refresh()
  }
})
