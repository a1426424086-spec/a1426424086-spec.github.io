const store = require('../../utils/store')
const N = require('../../utils/nutrition')

const UNITS = ['不按份', '个', '根', '份', '片', '碗', '杯', '包', '盒', '桶']

function num(s) {
  const v = parseFloat(s)
  return isFinite(v) ? v : NaN
}

Page({
  data: {
    id: '',
    name: '',
    categories: N.CATEGORIES,
    categoryIndex: -1,
    carbs: '',
    protein: '',
    fat: '',
    factor: '80',
    factorTouched: false,
    units: UNITS,
    unitIndex: 0,
    servingGrams: '',
    weight: '',
    note: '',
    kcal: '—',
    effective: '—'
  },

  onLoad(q) {
    const food = q.id ? store.getFood(q.id) : null
    if (q.id && !food) {
      wx.showToast({ title: '食物不存在', icon: 'none' })
      return
    }
    wx.setNavigationBarTitle({ title: food ? '编辑食材' : '新增食材' })
    if (!food) return
    const unitIndex = food.servingUnit ? UNITS.indexOf(food.servingUnit) : 0
    this.setData({
      id: food.id,
      name: food.name,
      categoryIndex: N.CATEGORIES.indexOf(food.category),
      carbs: String(food.carbs),
      protein: String(food.protein),
      fat: String(food.fat),
      factor: String(N.round(food.factor * 100, 1)),
      factorTouched: true,
      units: unitIndex < 0 ? UNITS.concat(food.servingUnit) : UNITS,
      unitIndex: unitIndex < 0 ? UNITS.length : unitIndex,
      servingGrams: food.servingGrams ? String(food.servingGrams) : '',
      weight: food.weight || '',
      note: food.note || ''
    })
    this.compute()
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value })
    this.compute()
  },

  onCategory(e) {
    const categoryIndex = Number(e.detail.value)
    const patch = { categoryIndex }
    // 未手动改过折算比例时，按分类给默认值：肉蛋奶100%、蔬果50%、其余80%
    if (!this.data.factorTouched) {
      patch.factor = String(N.defaultFactor({ category: N.CATEGORIES[categoryIndex], name: this.data.name }) * 100)
    }
    this.setData(patch)
    this.compute()
  },

  setFactor(e) {
    this.setData({ factor: e.currentTarget.dataset.v, factorTouched: true })
    this.compute()
  },

  onFactorInput(e) {
    this.setData({ factor: e.detail.value, factorTouched: true })
    this.compute()
  },

  onUnit(e) {
    this.setData({ unitIndex: Number(e.detail.value) })
  },

  compute() {
    const c = num(this.data.carbs)
    const p = num(this.data.protein)
    const f = num(this.data.fat)
    const k = num(this.data.factor)
    const ok = [c, p, f].every(v => v >= 0)
    this.setData({
      kcal: ok ? N.round(N.kcalPer100({ carbs: c, protein: p, fat: f }), 1) : '—',
      effective: p >= 0 && k >= 0 ? N.round((p * k) / 100, 1) : '—'
    })
  },

  save() {
    const d = this.data
    const unit = d.unitIndex > 0 ? d.units[d.unitIndex] : ''
    const food = {
      name: d.name,
      category: N.CATEGORIES[d.categoryIndex],
      carbs: num(d.carbs),
      protein: num(d.protein),
      fat: num(d.fat),
      factor: num(d.factor) / 100,
      weight: d.weight.trim(),
      note: d.note.trim()
    }
    if (d.id) food.id = d.id
    // 空字符串会让 saveFood 去掉原有的份量单位
    food.servingUnit = unit
    food.servingGrams = unit ? num(d.servingGrams) : 0
    // 编辑时保留原有的其他字段（来源说明等）
    const original = d.id ? store.getFood(d.id) : null
    let res
    try {
      res = store.saveFood(Object.assign({}, original, food))
    } catch (e) {
      res = { ok: false, error: '保存失败，请检查存储空间' }
    }
    if (!res.ok) {
      wx.showToast({ title: res.error, icon: 'none' })
      return
    }
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 500)
  },

  remove() {
    wx.showModal({
      title: '删除“' + this.data.name + '”？',
      content: '已有的记录和食谱不变。',
      confirmText: '删除',
      confirmColor: '#d9534f',
      success: r => {
        if (!r.confirm) return
        store.deleteFood(this.data.id)
        wx.showToast({ title: '食材已删除', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 500)
      }
    })
  }
})
