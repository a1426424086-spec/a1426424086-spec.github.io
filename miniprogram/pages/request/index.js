const T = require('../../utils/tdee')
const { ENV_ID } = require('../../config/cloud')

const DRAFT_KEY = 'sg_request_draft'
const LAST_KEY = 'sg_request_last'
const FIELDS = ['sex', 'age', 'height', 'weight', 'activity', 'goal', 'message']

function emptyForm() {
  return { sex: '', age: '', height: '', weight: '', activity: '', goal: '', message: '' }
}

function lastLabel(last) {
  if (!last || typeof last.id !== 'string' || !last.id || !Number.isFinite(last.createdAt)) return ''
  const date = new Date(last.createdAt)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = n => n < 10 ? '0' + n : String(n)
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

Page({
  data: {
    form: emptyForm(),
    activities: T.ACTIVITIES,
    goals: T.GOALS,
    goalIndex: -1,
    goalTitle: '',
    kcal: null,
    targetKcal: null,
    errors: {},
    submitError: '',
    storageError: '',
    last: null,
    lastTime: '',
    cloudEnabled: !!ENV_ID,
    submitting: false,
    withdrawing: false
  },

  onLoad() {
    this.touched = {}
    this.submitAttempted = false
    const form = emptyForm()
    let last = null
    try {
      const saved = wx.getStorageSync(DRAFT_KEY)
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        FIELDS.forEach(key => {
          if (typeof saved[key] === 'string' || typeof saved[key] === 'number') form[key] = String(saved[key])
        })
        form.message = form.message.slice(0, 300)
      }
      last = wx.getStorageSync(LAST_KEY) || null
    } catch (e) {
      this.setData({ storageError: '本机存储不可用，草稿暂时无法恢复' })
    }
    const lastTime = lastLabel(last)
    this.setData({ form, last: lastTime ? last : null, lastTime })
    this.refresh()
  },

  refresh() {
    const form = this.data.form
    const result = T.validate(form)
    const errors = {}
    Object.keys(result.errors).forEach(key => {
      if (key !== 'form' && (this.submitAttempted || this.touched[key] || form[key])) errors[key] = result.errors[key]
    })
    const goalIndex = T.GOALS.findIndex(item => item.key === form.goal)
    this.setData({
      errors,
      submitError: this.submitAttempted && !result.ok ? result.errors.form || '填写的内容有误，请检查' : '',
      kcal: T.tdee(form),
      targetKcal: T.target(form),
      goalIndex,
      goalTitle: goalIndex < 0 ? '' : T.GOALS[goalIndex].title
    })
    return result
  },

  saveDraft() {
    try {
      wx.setStorageSync(DRAFT_KEY, this.data.form)
      this.setData({ storageError: '' })
    } catch (e) {
      this.setData({ storageError: '本机存储不可用，草稿暂时无法保存' })
    }
  },

  updateField(key, value) {
    if (this.data.submitting || this.data.withdrawing || FIELDS.indexOf(key) < 0) return
    this.touched[key] = true
    this.setData({ ['form.' + key]: value })
    this.refresh()
    this.saveDraft()
  },

  onInput(e) {
    const key = e.currentTarget.dataset.k
    const value = e.detail.value
    this.updateField(key, key === 'message' ? value.slice(0, 300) : value)
  },

  setSex(e) {
    const value = e.currentTarget.dataset.v
    this.updateField('sex', this.data.form.sex === value ? '' : value)
  },

  setActivity(e) {
    const value = e.currentTarget.dataset.v
    this.updateField('activity', this.data.form.activity === value ? '' : value)
  },

  setGoal(e) {
    const value = e.currentTarget.dataset.v
    this.updateField('goal', this.data.form.goal === value ? '' : value)
  },

  showResult(code) {
    const messages = {
      limit: '今天已经提交 3 次了，明天再来，或者直接私信作者',
      invalid: '填写的内容有误，请检查',
      not_found: '这次提交已不存在'
    }
    wx.showToast({ title: messages[code] || '网络不稳定，稍后再试', icon: 'none' })
  },

  async submit() {
    if (this.data.submitting || this.data.withdrawing) return
    if (!ENV_ID) {
      wx.showToast({ title: '提交功能还没开通，可以先私信作者', icon: 'none' })
      return
    }
    this.submitAttempted = true
    if (!this.refresh().ok) return
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      this.showResult()
      return
    }
    const form = Object.assign({}, this.data.form)
    this.setData({ submitting: true, submitError: '' })
    try {
      const response = await wx.cloud.callFunction({
        name: 'request',
        data: { action: 'submit', form, appVersion: '1.0.2' },
        timeout: 8000
      })
      const result = response && response.result
      if (!result || !result.ok) {
        this.showResult(result && result.code)
        return
      }
      const last = { id: result.id, createdAt: result.createdAt }
      const lastTime = lastLabel(last)
      if (!lastTime) {
        this.showResult()
        return
      }
      this.submitAttempted = false
      this.touched.message = false
      this.setData({ last, lastTime, 'form.message': '' })
      this.refresh()
      this.saveDraft()
      try {
        wx.setStorageSync(LAST_KEY, last)
      } catch (e) {
        this.setData({ storageError: '已提交，本机未能保存提交记录，请在离开前撤回或私信作者' })
      }
      wx.showToast({ title: '已提交，作者看到后会联系你', icon: 'none' })
    } catch (e) {
      this.showResult()
    } finally {
      this.setData({ submitting: false })
    }
  },

  withdraw() {
    if (!ENV_ID || !this.data.last || this.data.submitting || this.data.withdrawing) return
    const id = this.data.last.id
    this.setData({ withdrawing: true })
    wx.showModal({
      title: '撤回最近一次提交？',
      confirmText: '撤回',
      success: async res => {
        if (!res.confirm) {
          this.setData({ withdrawing: false })
          return
        }
        try {
          if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
            this.showResult()
            return
          }
          const response = await wx.cloud.callFunction({ name: 'request', data: { action: 'withdraw', id }, timeout: 8000 })
          const result = response && response.result
          if (!result || !result.ok) {
            this.showResult(result && result.code)
            return
          }
          this.setData({ last: null, lastTime: '' })
          try {
            wx.removeStorageSync(LAST_KEY)
          } catch (e) {
            this.setData({ storageError: '已撤回，本机提交记录暂时无法清除' })
          }
          wx.showToast({ title: '已撤回', icon: 'none' })
        } catch (e) {
          this.showResult()
        } finally {
          this.setData({ withdrawing: false })
        }
      },
      fail: () => {
        this.setData({ withdrawing: false })
        this.showResult()
      }
    })
  }
})
