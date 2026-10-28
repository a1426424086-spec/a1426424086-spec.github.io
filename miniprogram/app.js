const store = require('./utils/store')

App({
  globalData: {
    // 从统计/食谱页跳到「配餐」tab 时要打开的日期（switchTab 不能带参数）
    pendingDate: ''
  },

  onLaunch() {
    try {
      store.init()
    } catch (e) {
      wx.showToast({ title: '本机存储不可用', icon: 'none' })
    }
  },

  openDay(date) {
    this.globalData.pendingDate = date
    wx.switchTab({ url: '/pages/day/index' })
  }
})
