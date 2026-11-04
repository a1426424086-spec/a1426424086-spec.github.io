const store = require('../../utils/store')
const N = require('../../utils/nutrition')
const D = require('../../utils/date')

function byTime(a, b) {
  return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
}

Page({
  data: {
    date: '', today: '', dateLabel: '', greeting: '', isToday: true,
    totals: N.display(N.empty()), count: 0, meals: [], open: -1, foldH: 0, leavingId: '', dayAnim: '',
    topPad: 88, navH: 88, menuTop: 48, menuH: 32, navShow: false,
    weeks: [], weekIdx: 0, kcalShown: 0, delW: 88, resetKey: 0,
    sheet: 'none', sheetShow: false, ed: null, cal: null, qtyEditing: false, kbRaise: 0,
    ringImg: '', ringSnap: false, ringImgShow: false,
    toast: { text: '', undo: false, show: false }, weekNames: D.WEEK_MON
  },

  onLoad() {
    const menu = wx.getMenuButtonBoundingClientRect()
    this.setData({ topPad: menu.bottom + 20, navH: menu.bottom + 8,
      menuTop: menu.top, menuH: menu.height,
      delW: Math.round(176 * wx.getWindowInfo().windowWidth / 750) })
    this.pendingOpen = -1
  },

  onShow() {
    const app = getApp()
    let date = this.data.date || D.today()
    const pendingDate = app.globalData.pendingDate
    if (pendingDate) {
      date = pendingDate
      app.globalData.pendingDate = ''
    }
    if (!this.shown || date !== this.data.date || pendingDate || this.daySig(date) !== this.lastSig) {
      this.load(date, !this.shown)
    }
    this.shown = true
    if (this.pendingOpen >= 0) {
      const i = this.pendingOpen
      this.pendingOpen = -1
      if (this.data.meals[i] && this.data.meals[i].items.length) this.setData({ open: i }, () => {
        this.measureFold(i)
        clearTimeout(this.refoldTimer)
        this.refoldTimer = setTimeout(() => { if (this.data.open >= 0) this.measureFold(this.data.open) }, 450)
      })
    }
  },

  onReady() {
    wx.createSelectorQuery().select('#ring').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) return
      const canvas = res[0].node
      const dpr = wx.getWindowInfo().pixelRatio
      canvas.width = res[0].width * dpr
      canvas.height = res[0].height * dpr
      this.cv = canvas
      this.ctx = canvas.getContext('2d')
      this.ctx.scale(dpr, dpr)
      this.cvSize = res[0].width
      this.drawRing(this.shares, true)
    })
  },

  onUnload() {
    this.stopKcal()
    clearTimeout(this.toastTimer)
    clearTimeout(this.sheetTimer)
    clearTimeout(this.dayTimer)
    clearTimeout(this.deleteTimer)
    clearTimeout(this.leaveTimer)
    clearTimeout(this.refoldTimer)
    clearTimeout(this.unsnapTimer)
    this.leaveDone = null
    if (this.cv) this.cv.cancelAnimationFrame(this.raf)
  },

  // 当天和前一天的记录没变就不重载，切 tab 回来不闪
  daySig(date) {
    return JSON.stringify([store.getDay(date).portions, store.getDay(D.addDays(date, -1)).portions.map(p => p.meal), store.listDates().length, D.today()])
  },

  load(date, fromZero) {
    this.lastSig = this.daySig(date)
    const today = D.today()
    const day = store.getDay(date)
    const yesterday = store.getDay(D.addDays(date, -1))
    const ids = day.portions.map(p => p.id)
    const prev = this.prevIds && this.prevIds.date === date ? this.prevIds.set : null
    if (!prev) this.freshUntil = {}
    const now = Date.now()
    ids.forEach(id => {
      if (prev && !prev.has(id)) this.freshUntil[id] = now + 450
    })
    this.prevIds = { date, set: new Set(ids) }
    this.portions = day.portions
    const icons = ['sunrise', 'sun', 'moon', 'cup']
    const meals = N.MEALS.map((name, i) => {
      const list = day.portions.filter(p => p.meal === name).sort(byTime)
      const m = N.display(N.totals(list))
      return {
        name, icon: icons[i], kcal: m.kcal, m,
        canAgain: !list.length && yesterday.portions.some(p => p.meal === name),
        items: list.map(p => ({
          id: p.id, name: p.food.name, fresh: (this.freshUntil[p.id] || 0) > now,
          short: N.round(p.grams) + ' 克',
          kcal: N.round(N.forGrams(p.food, p.grams).kcal),
          m: N.display(N.forGrams(p.food, p.grams))
        }))
      }
    })
    const totals = N.totals(day.portions)
    const weeks = this.buildWeeks(date)
    const wsig = JSON.stringify(weeks.weeks.map(w => w.days.map(d => d.cls)).concat([weeks.weekIdx, this.weekBase]))
    const weekPatch = {}
    if (wsig !== this.lastWeekSig) {
      weekPatch.weeks = weeks.weeks
      weekPatch.weekIdx = weeks.weekIdx
      this.lastWeekSig = wsig
    }
    this.setData({ date, today, isToday: date === today,
      greeting: date === today ? D.greeting() : date > today ? '提前安排' : '回看这一天',
      dateLabel: D.short(date) + ' ' + D.weekday(date), totals: N.display(totals),
      meals, count: day.portions.length, ...weekPatch,
      resetKey: this.data.resetKey + 1 }, () => {
      if (this.data.open >= 0) {
        this.measureFold(this.data.open)
        clearTimeout(this.refoldTimer)
        this.refoldTimer = setTimeout(() => { if (this.data.open >= 0) this.measureFold(this.data.open) }, 450)
      }
    })
    this.tweenKcal(N.round(totals.kcal), fromZero)
    this.drawRing(day.portions.length ? N.macroShare(totals) : null, fromZero)
  },

  // 千卡数字从当前值过渡，约 30 帧/秒更新，结尾落到准确值
  tweenKcal(to, fromZero) {
    this.stopKcal()
    const from = fromZero ? 0 : (this.kcalNow || 0)
    if (from === to) { this.kcalNow = to; this.setData({ kcalShown: to }); return }
    const start = Date.now(), duration = fromZero ? 900 : 600
    let last = 0
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration)
      const v = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)))
      this.kcalNow = v
      const now = Date.now()
      if (t === 1 || (v !== this.data.kcalShown && now - last >= 32)) { last = now; this.setData({ kcalShown: v }) }
      if (t < 1) this.kcalTick = setTimeout(tick, 16)
    }
    tick()
  },
  stopKcal() { clearTimeout(this.kcalTick) },

  buildWeeks(date) {
    const today = D.today()
    const has = new Set(store.listDates().filter(d => store.getDay(d).portions.length))
    const m0 = D.mondayOf(date)
    if (!this.weekBase || m0 < this.weekBase || m0 > D.addDays(this.weekBase, (this.weekCount - 1) * 7)) {
      this.weekBase = D.addDays(D.mondayOf(today), -52 * 7)
      this.weekCount = 61
      if (m0 < this.weekBase || m0 > D.addDays(this.weekBase, 60 * 7)) {
        this.weekBase = D.addDays(m0, -26 * 7)
        this.weekCount = 53
      }
    }
    const weeks = Array.from({ length: this.weekCount }, (_, w) => {
      const key = D.addDays(this.weekBase, w * 7)
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = D.addDays(key, i)
        const parsed = D.parse(d)
        const n = parsed.getDate()
        return { date: d, n, top: n === 1 ? (parsed.getMonth() + 1) + '月' : D.WEEK_MON[i],
          cls: ['wd', d > today ? 'future' : '', d === today ? 'today' : '',
            d === date ? 'sel' : '', has.has(d) ? 'has' : '', n === 1 ? 'mon' : ''].filter(Boolean).join(' ') }
      })
      return { key, days }
    })
    return { weeks, weekIdx: weeks.findIndex(w => w.key === m0) }
  },

  onWeekChange(e) {
    if (e.detail.source === 'touch') this.setData({ weekIdx: e.detail.current })
  },
  pickDay(e) { this.goDay(e.currentTarget.dataset.date) },
  backToday() { this.goDay(D.today()) },
  prevDay() { this.goDay(D.addDays(this.data.date, -1)) },
  nextDay() { this.goDay(D.addDays(this.data.date, 1)) },
  goDay(date) {
    if (date === this.data.date) return
    const dir = date > this.data.date ? 'r' : 'l'
    this.flip = !this.flip
    this.setData({ open: -1, dayAnim: 'in-' + dir + (this.flip ? '1' : '2') })
    this.load(date, false)
  },
  onTouchStart(e) {
    const t = e.touches[0]
    this.touch = { x: t.clientX, y: t.clientY }
  },
  onTouchEnd(e) {
    if (!this.touch) return
    const t = e.changedTouches[0]
    const dx = t.clientX - this.touch.x
    const dy = t.clientY - this.touch.y
    this.touch = null
    // 横向滑动超过 60px 且明显比纵向大，才算翻页
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0) this.nextDay()
    else this.prevDay()
  },
  onPageScroll(e) {
    const s = e.scrollTop > 60
    if (s !== this.data.navShow) this.setData({ navShow: s }, () => this.syncRingSnap())
  },

  syncRingSnap() {
    const snap = this.data.sheet !== 'none' || this.data.navShow
    if (snap && this.cv) {
      clearTimeout(this.unsnapTimer)
      try {
        const url = this.cv.toDataURL('image/png')
        this.setData({ ringImg: url, ringImgShow: true, ringSnap: true })
      } catch (e) {
        this.setData({ ringSnap: false, ringImgShow: false })
      }
    } else if (!snap && this.data.ringSnap) {
      // 画布移回后在 iPhone 上可能是空的，保留图片并在重画后刷新
      this.setData({ ringSnap: false }, () => {
        clearTimeout(this.unsnapTimer)
        this.unsnapTimer = setTimeout(() => {
          this.drawRing(this.shares, false)
        }, 60)
      })
    }
  },

  // 静止时一律显示画布截图，避免 iPhone 上画布不显示
  snapRing() {
    if (!this.cv) return
    try {
      this.setData({ ringImg: this.cv.toDataURL('image/png'), ringImgShow: true })
    } catch (e) {
      this.setData({ ringImgShow: false, ringSnap: false })
    }
  },

  drawRing(shares, fromZero) {
    this.shares = shares
    if (!this.ctx) return
    this.cv.cancelAnimationFrame(this.raf)
    const ctx = this.ctx, S = this.cvSize, r = S / 2 - 12, lw = 16
    const cap = (lw / 2 + 1.5) / r
    const colors = [['#f3d697', '#d4a95c'], ['#d88c58', '#a9643a'], ['#b3a893', '#857c6b']]
    const target = shares ? [shares.c, shares.p, shares.f] : [0, 0, 0]
    const from = fromZero ? [0, 0, 0] : (this.ringShown || [0, 0, 0])
    const paint = values => {
      ctx.clearRect(0, 0, S, S)
      ctx.lineWidth = lw
      ctx.lineCap = 'round'
      ctx.strokeStyle = '#2a2722'
      ctx.beginPath()
      ctx.arc(S / 2, S / 2, r, 0, Math.PI * 2)
      ctx.stroke()
      let at = -Math.PI / 2
      values.forEach((value, i) => {
        const angle = value / 100 * Math.PI * 2
        if (angle > 0) {
          const gradient = ctx.createLinearGradient(0, 0, S, S)
          gradient.addColorStop(0, colors[i][0])
          gradient.addColorStop(1, colors[i][1])
          ctx.strokeStyle = gradient
          const start = at + Math.min(cap, angle / 2)
          ctx.beginPath()
          ctx.arc(S / 2, S / 2, r, start, start + Math.max(0.01, angle - 2 * cap))
          ctx.stroke()
        }
        at += angle
      })
      this.ringShown = values
    }
    if (from.every((v, i) => v === target[i])) {
      paint(target)
      this.snapRing()
      return
    }
    if (!this.data.ringSnap) this.setData({ ringImgShow: false })
    const start = Date.now(), duration = fromZero ? 900 : 600
    const frame = () => {
      const t = Math.min(1, (Date.now() - start) / duration)
      const ease = 1 - Math.pow(1 - t, 3)
      paint(target.map((v, i) => from[i] + (v - from[i]) * ease))
      if (t < 1) this.raf = this.cv.requestAnimationFrame(frame)
      else this.snapRing()
    }
    frame()
  },

  // 量出某一餐展开后的高度（px）
  measureFold(i, extra, cb) {
    this.createSelectorQuery().select('#items-' + i).boundingClientRect(r => {
      if (r && r.height === this.data.foldH && !extra) {
        if (cb) cb()
        return
      }
      this.setData(Object.assign({ foldH: r ? r.height : 0 }, extra || {}), cb)
    }).exec()
  },

  toggleMeal(e) {
    const i = Number(e.currentTarget.dataset.i)
    const meal = this.data.meals[i]
    if (meal && !meal.items.length) {
      this.addTo({ currentTarget: { dataset: { meal: meal.name } } })
      return
    }
    if (this.data.open === i) this.setData({ open: -1, resetKey: this.data.resetKey + 1 })
    else this.measureFold(i, { open: i, resetKey: this.data.resetKey + 1 })
  },
  addTo(e) {
    const meal = e.currentTarget.dataset.meal
    this.pendingOpen = N.MEALS.indexOf(meal)
    wx.navigateTo({ url: '/pages/pick/index?date=' + this.data.date + '&meal=' + encodeURIComponent(meal) })
  },
  copyYesterday(e) {
    const date = this.data.date, meal = e.currentTarget.dataset.meal
    this.safe(() => {
      const ids = store.copyMeal(D.addDays(date, -1), date, meal)
      this.setData({ open: N.MEALS.indexOf(meal) })
      this.load(date)
      this.showToast('已照昨天加入 ' + ids.length + ' 样', () => {
        ids.forEach(id => store.removePortion(date, id))
        this.setData({ open: -1 })
        this.load(date)
      })
    })
  },
  delItem(e) { this.removeWithUndo(e.currentTarget.dataset.id) },
  removeWithUndo(id) {
    clearTimeout(this.leaveTimer)
    // 连续删除时先完成上一笔，避免取消定时器后漏删
    if (this.leaveDone) this.leaveDone()
    const date = this.data.date
    const found = store.getDay(date).portions.find(p => p.id === id)
    if (!found) return
    const p = JSON.parse(JSON.stringify(found))
    const finish = () => {
      this.leaveDone = null
      this.safe(() => {
        store.removePortion(date, id)
        if (!store.getDay(date).portions.some(x => x.meal === p.meal)) this.setData({ open: -1 })
        this.load(date)
        this.showToast('已删除 ' + p.food.name.replace(/[（(].*?[）)]/g, ''), () => {
          store.restorePortions(date, [p])
          this.setData({ open: N.MEALS.indexOf(p.meal) })
          this.load(date)
        })
      })
      this.setData({ leavingId: '' })
    }
    const i = N.MEALS.indexOf(p.meal)
    if (this.data.open !== i) { finish(); return }
    this.leaveDone = finish
    this.createSelectorQuery().select('#it-' + id).boundingClientRect(r => {
      if (this.leaveDone !== finish) return
      const patch = { leavingId: id }
      if (this.data.meals[i].items.length === 1) patch.open = -1
      else patch.foldH = this.data.foldH - (r ? r.height : 0)
      this.setData(patch)
      this.leaveTimer = setTimeout(finish, 280)
    }).exec()
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
    this.setData({ sheet: kind, sheetShow: false, qtyEditing: false }, () => this.syncRingSnap())
    this.sheetTimer = setTimeout(() => this.setData({ sheetShow: true }), 20)
  },
  closeSheet() {
    clearTimeout(this.sheetTimer)
    this.setData({ sheetShow: false, kbRaise: 0 })
    this.sheetTimer = setTimeout(() => this.setData({ sheet: 'none', ed: null }, () => this.syncRingSnap()), 320)
  },
  onItemTap(e) {
    const p = this.portions.find(x => x.id === e.currentTarget.dataset.id)
    if (!p) return
    const qty = N.round(p.grams)
    this.editFood = p.food
    this.setData({ ed: { id: p.id, name: p.food.name, per100: N.display(N.per100(p.food)),
      unit: '克', qty,
      hint: '克',
      meal: N.MEALS.indexOf(p.meal), time: p.time,
      live: N.display(N.forGrams(p.food, qty)) }, resetKey: this.data.resetKey + 1 })
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
  pickTime(e) { this.setData({ 'ed.time': e.detail.value }) },
  sheetDone() {
    const ed = this.data.ed
    const grams = Number(ed.qty)
    if (!(grams > 0 && grams <= N.MAX_GRAMS)) {
      wx.showToast({ title: '重量须大于0，不超过10,000克', icon: 'none' })
      return
    }
    this.safe(() => {
      const p = this.portions.find(x => x.id === ed.id)
      store.updatePortion(this.data.date, ed.id, { grams: N.round(grams, 1), meal: N.MEALS[ed.meal], time: ed.time, unit: '克' })
      this.setData({ open: ed.meal })
      if (p && p.meal !== N.MEALS[ed.meal]) this.showToast('已移到' + N.MEALS[ed.meal])
      this.closeSheet()
    })
  },
  sheetDelete() {
    const id = this.data.ed.id
    this.closeSheet()
    this.deleteTimer = setTimeout(() => this.removeWithUndo(id), 200)
  },

  openCal() {
    const d = D.parse(this.data.date)
    this.calMonth = { y: d.getFullYear(), m: d.getMonth() + 1 }
    this.renderCal()
    this.openSheet('cal')
  },
  renderCal() {
    const { y, m } = this.calMonth
    const today = D.today(), date = this.data.date
    const has = new Set(store.listDates().filter(d => store.getDay(d).portions.length))
    const blank = (new Date(y, m - 1, 1).getDay() + 6) % 7
    const cells = Array.from({ length: blank }, (_, i) => ({ blank: true, key: 'b' + i }))
    const days = new Date(y, m, 0).getDate()
    for (let n = 1; n <= days; n++) {
      const d = D.format(new Date(y, m - 1, n))
      cells.push({ date: d, n, key: d, cls: ['c', d > today ? 'future' : '',
        d === today ? 'today' : '', d === date ? 'sel' : '', has.has(d) ? 'has' : ''].filter(Boolean).join(' ') })
    }
    this.setData({ cal: { title: y + '年' + m + '月', cells } })
  },
  calPrev() { this.shiftMonth(-1) },
  calNext() { this.shiftMonth(1) },
  shiftMonth(delta) {
    const d = new Date(this.calMonth.y, this.calMonth.m - 1 + delta, 1)
    this.calMonth = { y: d.getFullYear(), m: d.getMonth() + 1 }
    this.renderCal()
  },
  calPick(e) {
    const date = e.currentTarget.dataset.date
    this.closeSheet()
    clearTimeout(this.dayTimer)
    this.dayTimer = setTimeout(() => this.goDay(date), 120)
  },
  calToday() { this.calPick({ currentTarget: { dataset: { date: D.today() } } }) },

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
      confirmColor: '#f0705e',
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
