const store = require('../../utils/store')
const N = require('../../utils/nutrition')
const D = require('../../utils/date')

const HISTORY_PAGE = 30

Page({
  data: {
    range: 7,
    bars: [],
    avg: null,
    recorded: 0,
    mealShare: [],
    history: [],
    hasMore: false
  },

  onShow() {
    this.historyLimit = HISTORY_PAGE
    this.load()
  },

  setRange(e) {
    this.setData({ range: Number(e.currentTarget.dataset.r) })
    this.load()
  },

  load() {
    const range = this.data.range
    const today = D.today()
    const days = []
    for (let i = range - 1; i >= 0; i--) {
      const date = D.addDays(today, -i)
      const portions = store.getDay(date).portions
      days.push({ date, portions, totals: N.totals(portions) })
    }

    const withData = days.filter(d => d.portions.length)
    const max = Math.max.apply(null, days.map(d => d.totals.kcal).concat(1))
    const showEvery = range > 7 ? 5 : 1
    const bars = days.map((d, i) => ({
      date: d.date,
      kcal: N.round(d.totals.kcal),
      height: d.portions.length ? Math.max(2, Math.round((d.totals.kcal / max) * 100)) : 0,
      label: i % showEvery === 0 || i === range - 1 ? (range > 7 ? D.short(d.date).replace('月', '/').replace('日', '') : D.weekday(d.date).slice(1)) : '',
      today: d.date === today
    }))

    let avg = null
    let mealShare = []
    if (withData.length) {
      const sum = withData.reduce((acc, d) => N.add(acc, d.totals), N.empty())
      const n = withData.length
      avg = N.display({ kcal: sum.kcal / n, carbs: sum.carbs / n, protein: sum.protein / n, effective: sum.effective / n, fat: sum.fat / n })
      const all = [].concat.apply([], withData.map(d => d.portions))
      const total = N.totals(all).kcal || 1
      mealShare = N.MEALS.map(m => {
        const k = N.totals(all.filter(p => p.meal === m)).kcal
        return { name: m, pct: Math.round((k / total) * 100) }
      })
    }

    this.setData({ bars, avg, recorded: withData.length, mealShare })
    this.loadHistory()
  },

  loadHistory() {
    const dates = store.listDates().slice().reverse()
    const history = dates.slice(0, this.historyLimit).map(date => {
      const portions = store.getDay(date).portions
      return {
        date,
        title: D.relative(date),
        week: D.weekday(date),
        year: date.slice(0, 4),
        count: portions.length,
        kcal: N.round(N.totals(portions).kcal)
      }
    })
    this.setData({ history, hasMore: dates.length > this.historyLimit })
  },

  more() {
    this.historyLimit += HISTORY_PAGE
    this.loadHistory()
  },

  openDay(e) {
    getApp().openDay(e.currentTarget.dataset.date)
  }
})
