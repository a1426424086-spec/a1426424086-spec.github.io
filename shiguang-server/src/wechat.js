const https = require('https')

// httpsGet 使用与 https.get 相同的回调接口；测试时注入本地替身。
function code2openid(code, { appid, secret, httpsGet = https.get } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof code !== 'string' || !code.trim() || !appid || !secret) {
      reject({ code: 'auth' })
      return
    }
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
    url.search = new URLSearchParams({ appid, secret, js_code: code, grant_type: 'authorization_code' }).toString()
    let request
    let settled = false
    const finish = openid => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (openid) resolve(openid)
      else reject({ code: 'auth' })
    }
    // 总时限包含 DNS、连接和响应读取，避免只依赖 socket 空闲超时。
    const timer = setTimeout(() => {
      finish()
      if (request) request.destroy()
    }, 5000)
    try {
      request = httpsGet(url, response => {
        if (response.statusCode !== 200) {
          response.resume()
          finish()
          return
        }
        const chunks = []
        let size = 0
        response.on('error', () => finish())
        response.on('aborted', () => finish())
        response.on('data', chunk => {
          if (settled) return
          size += Buffer.byteLength(chunk)
          if (size > 64 * 1024) {
            finish()
            response.destroy()
          } else chunks.push(Buffer.from(chunk))
        })
        response.on('end', () => {
          if (settled) return
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            finish(data && !Object.prototype.hasOwnProperty.call(data, 'errcode') && typeof data.openid === 'string' ? data.openid : undefined)
          } catch (e) {
            finish()
          }
        })
      })
      request.on('error', () => finish())
    } catch (e) {
      finish()
    }
  })
}

module.exports = { code2openid }
