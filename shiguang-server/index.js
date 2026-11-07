const { handle } = require('./src/app')
const { code2openid } = require('./src/wechat')
const { createTablestoreStore } = require('./src/store-tablestore')

const ENV_NAMES = ['WX_APPID', 'WX_SECRET', 'OTS_ENDPOINT', 'OTS_INSTANCE', 'OTS_TABLE']
const HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function parseEvent(event) {
  const parsed = JSON.parse(Buffer.isBuffer(event) ? event.toString('utf8') : event)
  if (!parsed || typeof parsed.rawPath !== 'string' || !parsed.requestContext ||
      !parsed.requestContext.http || typeof parsed.requestContext.http.method !== 'string' ||
      (parsed.body !== undefined && parsed.body !== null && typeof parsed.body !== 'string')) {
    throw new Error('无效事件')
  }
  let body = parsed.body || ''
  if (parsed.isBase64Encoded) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body)) throw new Error('无效编码')
    body = Buffer.from(body, 'base64')
  }
  return { method: parsed.requestContext.http.method, path: parsed.rawPath, body }
}

// 工厂只用于注入离线替身，不修改 process.env；生产使用 FC 环境和临时凭证。
function createHandler({ env = process.env, exchangeCode = code2openid, makeStore = createTablestoreStore, now = Date.now, logger = console } = {}) {
  return async (event, context) => {
    const started = Date.now()
    let path = '[unknown]'
    let response = { statusCode: 500, result: { ok: false, code: 'server' } }
    try {
      const missing = ENV_NAMES.filter(name => typeof env[name] !== 'string' || !env[name].trim())
      if (missing.length) {
        missing.forEach(name => logger.error('缺少环境变量 ' + name))
      } else {
        let request
        try {
          request = parseEvent(event)
        } catch (e) {
          response = { statusCode: 400, result: { ok: false, code: 'invalid' } }
        }
        if (request) {
          // 不记录任意外部路径或查询串，避免把用户内容带进日志。
          if (['/api/requests', '/api/requests/withdraw'].includes(request.path)) path = request.path
          // 首次读写时才创建客户端；每次调用均使用当前 FC 凭证。
          let store
          const getStore = () => store || (store = makeStore({ credentials: context && context.credentials, env }))
          response = await handle(request, {
            code2openid: code => exchangeCode(code, { appid: env.WX_APPID, secret: env.WX_SECRET }),
            store: {
              countSince: (...args) => getStore().countSince(...args),
              insert: (...args) => getStore().insert(...args),
              removeOwn: (...args) => getStore().removeOwn(...args)
            },
            now
          })
        }
      }
    } catch (e) {
      response = { statusCode: 500, result: { ok: false, code: 'server' } }
    }
    logger.info(JSON.stringify({ path, statusCode: response.statusCode, durationMs: Date.now() - started }))
    return { statusCode: response.statusCode, headers: { ...HEADERS }, body: JSON.stringify(response.result) }
  }
}

exports.parseEvent = parseEvent
exports.createHandler = createHandler
exports.handler = async (event, context) => createHandler()(event, context)
