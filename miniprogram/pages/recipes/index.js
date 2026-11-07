const store = require('../../utils/store')
const N = require('../../utils/nutrition')

const GROUPS = ['工作日', '居家', '吃得开心']

function summary(recipe, src) {
  const t = N.display(N.totals(store.recipePortions(recipe, src === 'mine')))
  return {
    id: recipe.id,
    src,
    name: recipe.name,
    nameParts: recipe.name.split(/(\d+(?:\.\d+)?)/),
    titleParts: (recipe.mealNotes || []).map(n => n.title).filter(Boolean).join(' / ').split(/(\d+(?:\.\d+)?)/),
    count: recipe.portions.length,
    kcal: t.kcal,
    carbs: t.carbs,
    effective: t.effective,
    titles: (recipe.mealNotes || []).map(n => n.title).filter(Boolean).join(' / ')
  }
}

Page({
  data: {
    tab: 'mine',
    mine: [],
    groups: []
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  onReady() {
    this.renderReady = true
    this.saveRenderCache()
  },

  onHide() {
    this.saveRenderCache()
  },

  // 用当前真实内容生成缓存，下次冷启动首次打开时先显示我的食谱。
  saveRenderCache() {
    if (!this.renderReady || typeof this.setInitialRenderingCache !== 'function') return
    const sig = this.lastSig
    if (!sig || sig === this.cacheSig) return
    this.setInitialRenderingCache({ tab: 'mine', mine: this.data.mine, groups: this.data.groups })
    this.cacheSig = sig
  },

  refresh() {
    const mine = store.getRecipes().map(r => summary(r, 'mine'))
    const refs = store.getReferenceRecipes()
    // 参考食谱：每组按碳水从高到低
    const groups = GROUPS.map(g => ({
      name: g,
      items: refs.filter(r => r.group === g).map(r => summary(r, 'ref')).sort((a, b) => b.carbs - a.carbs)
    })).filter(g => g.items.length)
    const sig = JSON.stringify([mine, groups])
    if (sig === this.lastSig) return
    this.lastSig = sig
    this.setData({ mine, groups })
  },

  setTab(e) {
    this.setData({ tab: e.currentTarget.dataset.t })
  },

  openRequest() {
    wx.navigateTo({ url: '/pages/request/index' })
  },

  createNew() {
    wx.showModal({
      title: '新建食谱',
      editable: true,
      placeholderText: '食谱名称，不填则自动命名',
      success: res => {
        if (!res.confirm) return
        const name = (res.content || '').trim() || '我的食谱 ' + (store.getRecipes().length + 1)
        let r
        try { r = store.createRecipe(name) } catch (e) { r = { ok: false, error: '保存失败，请检查存储空间' } }
        if (!r.ok) { wx.showToast({ title: r.error, icon: 'none' }); return }
        wx.navigateTo({ url: '/pages/recipe/index?id=' + r.recipe.id + '&src=mine' })
      }
    })
  },

  open(e) {
    const d = e.currentTarget.dataset
    wx.navigateTo({ url: '/pages/recipe/index?id=' + d.id + '&src=' + d.src })
  }
})
