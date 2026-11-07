const { validate, clean } = require('./logic')

const MAX_BODY_BYTES = 8 * 1024
const ID_PATTERN = /^\d{13}-[0-9a-f]{8}$/
const reply = (statusCode, result) => ({ statusCode, result })
const failure = (statusCode, code) => reply(statusCode, { ok: false, code })

async function handle({ method, path, body } = {}, deps = {}) {
  try {
    if (method !== 'POST' || !['/api/requests', '/api/requests/withdraw'].includes(path)) {
      return failure(404, 'bad_action')
    }
    let input
    try {
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body)
      if (typeof text !== 'string') return failure(400, 'invalid')
      if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return failure(413, 'invalid')
      input = JSON.parse(text)
    } catch (e) {
      return failure(400, 'invalid')
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failure(400, 'invalid')
    if (path === '/api/requests' && !validate(input.form).ok) return failure(400, 'invalid')

    let openid
    try {
      if (typeof input.code !== 'string' || !input.code.trim()) return failure(401, 'auth')
      openid = await deps.code2openid(input.code)
      if (typeof openid !== 'string' || !openid) return failure(401, 'auth')
    } catch (e) {
      return failure(401, 'auth')
    }

    if (path === '/api/requests/withdraw') {
      if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id)) return failure(404, 'not_found')
      const removed = await deps.store.removeOwn(openid, input.id)
      return removed ? reply(200, { ok: true }) : failure(404, 'not_found')
    }

    const now = (deps.now || Date.now)()
    // 固定 UTC+8，不使用运行环境的本地时区。
    const offset = 8 * 60 * 60 * 1000
    const sinceMs = Math.floor((now + offset) / 86400000) * 86400000 - offset
    if (await deps.store.countSince(openid, sinceMs) >= 3) return failure(429, 'limit')
    const id = await deps.store.insert(openid, {
      ...clean(input.form),
      appVersion: typeof input.appVersion === 'string' ? input.appVersion : '',
      createdAt: now
    })
    return reply(200, { ok: true, id, createdAt: now })
  } catch (e) {
    return failure(500, 'server')
  }
}

module.exports = { handle }
