const { randomBytes } = require('crypto')

// 仅供离线测试；生产入口不引用此模块。
function createMemoryStore() {
  const rows = new Map()
  return {
    async countSince(openid, sinceMs) {
      const start = String(sinceMs).padStart(13, '0')
      return Array.from((rows.get(openid) || new Map()).keys()).filter(id => id >= start).length
    },
    async insert(openid, doc) {
      const id = String(doc.createdAt).padStart(13, '0') + '-' + randomBytes(4).toString('hex')
      if (!rows.has(openid)) rows.set(openid, new Map())
      const own = rows.get(openid)
      if (own.has(id)) throw new Error('记录已存在')
      own.set(id, { ...doc })
      return id
    },
    async removeOwn(openid, id) {
      const own = rows.get(openid)
      return own ? own.delete(id) : false
    }
  }
}

module.exports = { createMemoryStore }
