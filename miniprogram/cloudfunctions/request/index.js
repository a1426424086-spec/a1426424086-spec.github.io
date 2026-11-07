const cloud = require('wx-server-sdk')
const { validate, clean } = require('./logic')

exports.main = async (event = {}) => {
  try {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
    if (!event || (event.action !== 'submit' && event.action !== 'withdraw')) return { ok: false, code: 'bad_action' }
    if (event.action === 'submit' && !validate(event.form).ok) return { ok: false, code: 'invalid' }
    const { OPENID: openid } = cloud.getWXContext()
    if (typeof openid !== 'string' || !openid) return { ok: false, code: 'server' }
    const db = cloud.database()
    const requests = db.collection('requests')

    if (event.action === 'submit') {
      // 用固定 UTC+8 计算北京时间当天零点，不依赖云函数的系统时区。
      const now = Date.now()
      const offset = 8 * 60 * 60 * 1000
      const start = new Date(Math.floor((now + offset) / 86400000) * 86400000 - offset)
      const count = await requests.where({ openid, createdAt: db.command.gte(start) }).count()
      if (count.total >= 3) return { ok: false, code: 'limit' }
      const result = await requests.add({
        data: { openid, ...clean(event.form), appVersion: event.appVersion || '', createdAt: db.serverDate() }
      })
      return { ok: true, id: result._id, createdAt: Date.now() }
    }

    if (typeof event.id !== 'string' || !event.id.trim()) return { ok: false, code: 'not_found' }
    const result = await requests.where({ _id: event.id, openid }).remove()
    return result.stats && result.stats.removed > 0 ? { ok: true } : { ok: false, code: 'not_found' }
  } catch (e) {
    return { ok: false, code: 'server' }
  }
}
