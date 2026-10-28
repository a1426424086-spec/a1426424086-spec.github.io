const store = require('../../utils/store')
const N = require('../../utils/nutrition')

const GROUPS = ['工作日', '居家', '吃得开心']

function summary(recipe, src) {
  const t = N.display(N.totals(store.recipePortions(recipe, src === 'mine')))
  return {
    id: recipe.id,
    src,
    name: recipe.name,
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

  onShow() {
    const mine = store.getRecipes().map(r => summary(r, 'mine'))
    const refs = store.getReferenceRecipes()
    // 参考食谱：每组按碳水从高到低
    const groups = GROUPS.map(g => ({
      name: g,
      items: refs.filter(r => r.group === g).map(r => summary(r, 'ref')).sort((a, b) => b.carbs - a.carbs)
    })).filter(g => g.items.length)
    this.setData({ mine, groups })
  },

  setTab(e) {
    this.setData({ tab: e.currentTarget.dataset.t })
  },

  open(e) {
    const d = e.currentTarget.dataset
    wx.navigateTo({ url: '/pages/recipe/index?id=' + d.id + '&src=' + d.src })
  }
})
