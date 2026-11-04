const store = require('../../utils/store')
const N = require('../../utils/nutrition')
const D = require('../../utils/date')

Page({
  data: {
    id: '',
    src: 'mine',
    name: '',
    totals: N.display(N.empty()),
    share: { c: 0, p: 0, f: 0 },
    meals: [],
    date: '',
    missing: false,
    count: 0, editable: false, leavingIdx: -1,
    sheet: 'none', sheetShow: false, ed: null, qtyEditing: false, kbRaise: 0,
    toast: { text: '', undo: false, show: false }
  },

  onLoad(q) {
    this.q = q
    this.load()
  },

  onShow() {
    if (!this.q) return
    if (!this.shownOnce) {
      this.shownOnce = true
      return
    }
    this.load()
  },

  onUnload() {
    clearTimeout(this.toastTimer)
    clearTimeout(this.sheetTimer)
    clearTimeout(this.deleteTimer)
    clearTimeout(this.leaveTimer)
  },

  load() {
    const q = this.q
    const src = q.src === 'ref' ? 'ref' : 'mine'
    const recipe = store.findRecipe(q.id, src)
    if (!recipe) {
      this.setData({ missing: true })
      return
    }
    const sig = JSON.stringify([recipe.name, recipe.portions, recipe.mealNotes || null])
    if (sig === this.lastSig) return
    this.lastSig = sig
    const prevCount = this.prevCount == null ? null : this.prevCount
    this.prevCount = recipe.portions.length
    const portions = store.recipePortions(recipe, src === 'mine')
    this.portions = portions
    const notes = recipe.mealNotes || []
    const meals = N.MEALS.map(m => {
      const list = portions.filter(p => p.meal === m)
      const note = notes.find(n => n.meal === m) || {}
      return {
        name: m,
        title: note.title || '',
        titleParts: (note.title || '').split(/(\d+(?:\.\d+)?)/),
        note: note.note || '',
        noteParts: (note.note || '').split(/(\d+(?:\.\d+)?)/),
        kcal: N.round(N.totals(list).kcal),
        m: N.display(N.totals(list)),
        items: list.map((p, i) => ({
          key: m + i,
          idx: p.idx,
          fresh: (prevCount !== null && recipe.portions.length > prevCount && p.idx >= prevCount) || p.idx === this.freshIdx,
          name: p.food.name,
          badge: N.badge(p.food.category),
          nameParts: p.food.name.split(/(\d+(?:\.\d+)?)/),
          qty: N.quantityText(p),
          m: N.display(N.forGrams(p.food, p.grams)),
          short: N.round(p.grams) + ' 克',
          qtyParts: N.quantityText(p).split(/(\d+(?:\.\d+)?)/),
          kcal: N.round(N.forGrams(p.food, p.grams).kcal)
        }))
      }
    }).filter(m => src === 'mine' || m.items.length)
    this.freshIdx = null
    const name = src === 'ref' ? '参考食谱 ' + recipe.name : recipe.name
    if (name !== this.titleShown) {
      wx.setNavigationBarTitle({ title: name })
      this.titleShown = name
    }
    this.setData({
      id: recipe.id,
      src,
      name,
      missing: false,
      count: recipe.portions.length,
      editable: src === 'mine',
      totals: N.display(N.totals(portions)),
      share: N.macroShare(N.totals(portions)) || { c: 0, p: 0, f: 0 },
      meals,
      date: D.today()
    })
  },

  addTo(e) {
    if (!this.data.editable) return
    const meal = e.currentTarget.dataset.meal
    wx.navigateTo({ url: '/pages/pick/index?recipe=' + this.data.id + '&meal=' + encodeURIComponent(meal) })
  },

  rename() {
    if (!this.data.editable) return
    wx.showModal({
      title: '食谱名称',
      editable: true,
      content: this.data.name,
      success: res => {
        const name = (res.content || '').trim()
        if (!res.confirm || !name) return
        this.safe(() => {
          store.renameRecipe(this.data.id, name)
          wx.setNavigationBarTitle({ title: name })
          this.titleShown = name
          this.load()
        })
      }
    })
  },

  showToast(text, undoFn) {
    clearTimeout(this.toastTimer)
    this.undoFn = undoFn
    this.setData({ toast: { text, undo: !!undoFn, show: true } })
    this.toastTimer = setTimeout(() => {
      this.setData({ 'toast.show': false })
      this.undoFn = null
    }, undoFn ? 3200 : 1400)
  },
  undo() {
    const fn = this.undoFn
    this.undoFn = null
    clearTimeout(this.toastTimer)
    this.setData({ 'toast.show': false })
    if (fn) this.safe(fn)
  },

  openSheet(kind) {
    clearTimeout(this.sheetTimer)
    this.setData({ sheet: kind, sheetShow: false, qtyEditing: false })
    this.sheetTimer = setTimeout(() => this.setData({ sheetShow: true }), 20)
  },
  closeSheet() {
    clearTimeout(this.sheetTimer)
    this.setData({ sheetShow: false, kbRaise: 0 })
    this.sheetTimer = setTimeout(() => this.setData({ sheet: 'none', ed: null }), 320)
  },
  onItemTap(e) {
    if (!this.data.editable) return
    const p = this.portions.find(x => x.idx === Number(e.currentTarget.dataset.idx))
    if (!p) return
    const qty = N.round(p.grams)
    this.editFood = p.food
    this.setData({ ed: { idx: p.idx, name: p.food.name, per100: N.display(N.per100(p.food)),
      unit: '克', qty,
      hint: '克',
      meal: N.MEALS.indexOf(p.meal),
      live: N.display(N.forGrams(p.food, qty)) } })
    this.openSheet('item')
  },
  updateQty(qty) {
    const grams = Number(qty)
    const patch = { 'ed.qty': qty, 'ed.hint': '克' }
    if (grams > 0 && grams <= N.MAX_GRAMS) patch['ed.live'] = N.display(N.forGrams(this.editFood, grams))
    this.setData(patch)
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
  onQtyInput(e) { this.updateQty(e.detail.value) },
  stepUp() { this.stepQty(1) },
  stepDown() { this.stepQty(-1) },
  stepQty(direction) {
    this.setData({ qtyEditing: false, kbRaise: 0 })
    const ed = this.data.ed
    const min = 5
    const max = N.MAX_GRAMS
    const current = Number(ed.qty) || min
    const step = (current - (direction < 0 ? 1 : 0)) < 50 ? 5 : 10
    this.updateQty(N.round(Math.min(max, Math.max(min, current + direction * step)), 3))
  },
  pickMeal(e) { this.setData({ 'ed.meal': Number(e.currentTarget.dataset.i) }) },
  sheetDone() {
    if (!this.data.editable || !this.data.ed) return
    const ed = this.data.ed
    const grams = Number(ed.qty)
    if (!(grams > 0 && grams <= N.MAX_GRAMS)) {
      wx.showToast({ title: '重量须大于0，不超过10,000克', icon: 'none' })
      return
    }
    this.safe(() => {
      const p = this.portions.find(x => x.idx === ed.idx)
      store.updateRecipePortion(this.data.id, ed.idx, { grams: N.round(grams, 1), meal: N.MEALS[ed.meal], unit: '克' })
      if (p && p.meal !== N.MEALS[ed.meal]) this.showToast('已移到' + N.MEALS[ed.meal])
      this.closeSheet()
      this.load()
    })
  },
  sheetDelete() {
    if (!this.data.editable || !this.data.ed) return
    const ed = this.data.ed, id = this.data.id, idx = ed.idx
    this.closeSheet()
    this.deleteTimer = setTimeout(() => {
      this.setData({ leavingIdx: idx })
      this.leaveTimer = setTimeout(() => {
        this.safe(() => {
          const removed = store.removeRecipePortion(id, idx)
          if (!removed) return
          this.load()
          this.showToast('已删除 ' + ed.name.replace(/[（(].*?[）)]/g, ''), () => {
            store.insertRecipePortion(id, idx, removed)
            this.freshIdx = idx
            this.load()
          })
        })
        this.setData({ leavingIdx: -1 })
      }, 280)
    }, 200)
  },

  safe(fn) {
    try {
      fn()
    } catch (e) {
      wx.showToast({ title: '保存失败，请检查存储空间', icon: 'none' })
    }
  },

  onPickDate(e) {
    if (this.data.count === 0) {
      wx.showToast({ title: '食谱还是空的，先加点食物', icon: 'none' })
      return
    }
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
