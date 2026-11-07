const store = require('./utils/store')
const { ENV_ID } = require('./config/cloud')

App({
  globalData: {
    // 从食谱页跳到「配餐」tab 时要打开的日期（switchTab 不能带参数）
    pendingDate: '',
    flashFoodId: ''
  },

  onLaunch() {
    try {
      store.init()
    } catch (e) {
      wx.showToast({ title: '本机存储不可用', icon: 'none' })
    }
    if (ENV_ID && wx.cloud) wx.cloud.init({ env: ENV_ID, traceUser: false })
  },

  openDay(date) {
    this.globalData.pendingDate = date
    wx.switchTab({ url: '/pages/day/index' })
  }
})
