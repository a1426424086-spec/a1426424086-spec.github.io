const assert = require('assert')
const { EventEmitter } = require('events')
const { handle } = require('../src/app')
const { createMemoryStore } = require('../src/store-memory')
const { code2openid } = require('../src/wechat')
const { createTablestoreStore } = require('../src/store-tablestore')
const { parseEvent, createHandler } = require('../index')

let passed = 0
async function test(name, run) {
  await run()
  passed += 1
  console.log('通过：' + name)
}
const clock = Date.parse('2026-11-07T15:59:59.999Z')
const form = { sex: 'm', age: 30, height: 175, weight: 70, activity: 'moderate', goal: 'cut', message: '  四餐  ' }
const input = { code: 'fake-code', form, appVersion: '1.0.2' }
const expected = (statusCode, code) => ({ statusCode, result: { ok: false, code } })
function harness() {
  let now = clock
  const deps = { store: createMemoryStore(), code2openid: async code => 'fake-user-' + code, now: () => now }
  return {
    deps,
    setNow: value => { now = value },
    submit: (body = input) => handle({ method: 'POST', path: '/api/requests', body }, deps),
    withdraw: (id, code = 'fake-code') => handle({ method: 'POST', path: '/api/requests/withdraw', body: { code, id } }, deps)
  }
}
function event(body = input, path = '/api/requests', base64 = false) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return JSON.stringify({ rawPath: path, requestContext: { http: { method: 'POST' } }, body: base64 ? Buffer.from(text).toString('base64') : text, isBase64Encoded: base64 })
}
function entryHarness(overrides = {}) {
  const logs = []
  const env = Object.fromEntries(['WX_APPID', 'WX_SECRET', 'OTS_ENDPOINT', 'OTS_INSTANCE', 'OTS_TABLE'].map(key => [key, 'fake-' + key]))
  const handler = createHandler({
    env,
    exchangeCode: async () => 'fake-entry-user',
    makeStore: () => createMemoryStore(),
    now: () => clock,
    logger: { error: text => logs.push(text), info: text => logs.push(text) },
    ...overrides
  })
  return { handler, logs, env }
}

// 模拟 Node https.get 的接口；不会使用网络。
function fakeGet(payload, statusCode = 200) {
  return (url, callback) => {
    assert.strictEqual(url.pathname, '/sns/jscode2session')
    assert.strictEqual(url.searchParams.get('grant_type'), 'authorization_code')
    assert.strictEqual(url.searchParams.get('js_code'), 'fake-code')
    const request = new EventEmitter()
    request.destroy = () => {}
    queueMicrotask(() => {
      const response = new EventEmitter()
      Object.assign(response, { statusCode, resume() {}, destroy() {} })
      callback(response)
      response.emit('data', Buffer.from(payload))
      response.emit('end')
    })
    return request
  }
}

// 官方 SDK 未安装；仅核对适配器构造的参数和分页、条件分支。
function fakeSDK() {
  const calls = []
  const options = { pages: [], putError: null, deleteError: null }
  let config
  const sdk = {
    Client: class {
      constructor(value) { config = value }
      getRange(params, done) { calls.push({ method: 'getRange', params }); done(null, options.pages.shift()) }
      putRow(params, done) { calls.push({ method: 'putRow', params }); done(options.putError, {}) }
      deleteRow(params, done) { calls.push({ method: 'deleteRow', params }); done(options.deleteError, {}) }
    },
    Direction: { FORWARD: 'forward' },
    INF_MAX: 'infinity',
    Condition: class { constructor(expectation, columnCondition) { Object.assign(this, { expectation, columnCondition }) } },
    RowExistenceExpectation: { EXPECT_NOT_EXIST: 'absent', EXPECT_EXIST: 'present' },
    Long: { fromNumber: number => ({ integer: number }) }
  }
  const credentials = { accessKeyId: 'fake-id', accessKeySecret: 'fake-secret', securityToken: 'fake-token' }
  const store = createTablestoreStore({ credentials, env: { OTS_ENDPOINT: 'fake-endpoint', OTS_INSTANCE: 'fake-instance' }, sdk })
  return { store, calls, options, config, credentials }
}

async function main() {
  await test('提交成功：身份、白名单、服务端时间及估算', async () => {
    const h = harness()
    let saved
    const insert = h.deps.store.insert
    h.deps.store.insert = (openid, doc) => { saved = { openid, doc }; return insert(openid, doc) }
    const response = await h.submit({ ...input, form: { ...form, openid: 'forged', extra: true, tdee: 1 } })
    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.result.ok, true)
    assert.match(response.result.id, /^\d{13}-[0-9a-f]{8}$/)
    assert.strictEqual(response.result.createdAt, clock)
    assert.strictEqual(response.result.id.slice(0, 13), String(clock))
    assert.strictEqual(saved.openid, 'fake-user-fake-code')
    assert.deepStrictEqual(saved.doc, { ...form, message: '四餐', tdee: 2560, target: 2180, appVersion: '1.0.2', createdAt: clock })
  })
  await test('仅留言可提交，空版本和非字符串版本安全处理', async () => {
    const h = harness()
    for (const appVersion of [undefined, {}]) {
      assert.strictEqual((await h.submit({ code: 'fake-code', form: { message: '留言' }, appVersion })).statusCode, 200)
    }
  })
  await test('校验失败先于身份交换', async () => {
    const h = harness()
    h.deps.code2openid = () => { throw new Error('不应交换身份') }
    for (const invalid of [{}, { sex: 'm' }, { ...form, age: 9 }, { ...form, height: 251 }, { ...form, weight: 300.1 }, { message: '字'.repeat(301) }]) {
      assert.deepStrictEqual(await h.submit({ ...input, form: invalid }), expected(400, 'invalid'))
    }
  })
  await test('换 openid 失败或 code 缺失时返回 401', async () => {
    const h = harness()
    for (const code of [undefined, '', {}, ' ']) assert.deepStrictEqual(await h.submit({ ...input, code }), expected(401, 'auth'))
    for (const exchange of [async () => { throw new Error('private-auth-detail') }, async () => '', async () => ({})]) {
      h.deps.code2openid = exchange
      assert.deepStrictEqual(await h.submit(), expected(401, 'auth'))
      assert.deepStrictEqual(await h.withdraw('1794050000000-abcdef12'), expected(401, 'auth'))
    }
  })
  await test('同一用户第 4 次被限额，不影响其他用户', async () => {
    const h = harness()
    for (let i = 0; i < 3; i++) assert.strictEqual((await h.submit()).statusCode, 200)
    assert.deepStrictEqual(await h.submit(), expected(429, 'limit'))
    assert.strictEqual((await h.submit({ ...input, code: 'fake-other' })).statusCode, 200)
  })
  await test('北京时间午夜前后重新计数，不依赖本机时区', async () => {
    const h = harness()
    const starts = []
    const count = h.deps.store.countSince
    h.deps.store.countSince = (openid, since) => { starts.push(since); return count(openid, since) }
    for (let i = 0; i < 3; i++) await h.submit()
    assert.deepStrictEqual(await h.submit(), expected(429, 'limit'))
    h.setNow(clock + 1)
    for (let i = 0; i < 3; i++) assert.strictEqual((await h.submit()).statusCode, 200)
    assert.deepStrictEqual(await h.submit(), expected(429, 'limit'))
    assert.deepStrictEqual(starts.slice(0, 4), Array(4).fill(Date.parse('2026-11-06T16:00:00Z')))
    assert.deepStrictEqual(starts.slice(4), Array(4).fill(Date.parse('2026-11-07T16:00:00Z')))
  })
  await test('撤回自己的成功，重复撤回 404，删除后不再计数', async () => {
    const h = harness()
    const { result } = await h.submit()
    assert.deepStrictEqual(await h.withdraw(result.id), { statusCode: 200, result: { ok: true } })
    assert.deepStrictEqual(await h.withdraw(result.id), expected(404, 'not_found'))
    assert.strictEqual(await h.deps.store.countSince('fake-user-fake-code', 0), 0)
  })
  await test('撤回别人的 404，不影响记录所有者', async () => {
    const h = harness()
    const { result } = await h.submit()
    assert.deepStrictEqual(await h.withdraw(result.id, 'fake-other'), expected(404, 'not_found'))
    assert.strictEqual((await h.withdraw(result.id)).statusCode, 200)
  })
  await test('id 格式错误不访问存储，返回 not_found', async () => {
    const h = harness()
    h.deps.store.removeOwn = () => { throw new Error('不应删除') }
    for (const id of [undefined, {}, '', 'bad', '1794050000000-ABCDEF12', '1794050000000-abcdef1']) {
      assert.deepStrictEqual(await h.withdraw(id), expected(404, 'not_found'))
    }
  })
  await test('未知路径和方法返回 404 bad_action', async () => {
    for (const [method, path] of [['GET', '/api/requests'], ['POST', '/missing'], ['DELETE', '/api/requests/withdraw']]) {
      assert.deepStrictEqual(await handle({ method, path, body: input }, {}), expected(404, 'bad_action'))
    }
  })
  await test('非法 JSON、空正文和非对象 JSON 返回 400', async () => {
    const h = harness()
    for (const body of ['{', '', 'null', '[]', '1', '"text"', Buffer.from('{')]) {
      assert.deepStrictEqual(await h.submit(body), expected(400, 'invalid'))
    }
  })
  await test('正文按 UTF-8 字节计量，8192 可用、8193 返回 413', async () => {
    const h = harness()
    const base = JSON.stringify({ ...input, padding: '' })
    const exact = JSON.stringify({ ...input, padding: ' '.repeat(8192 - Buffer.byteLength(base)) })
    assert.strictEqual(Buffer.byteLength(exact), 8192)
    assert.strictEqual((await h.submit(exact)).statusCode, 200)
    assert.deepStrictEqual(await h.submit(exact + ' '), expected(413, 'invalid'))
    assert.deepStrictEqual(await h.submit({ ...input, padding: '字'.repeat(3000) }), expected(413, 'invalid'))
  })
  await test('存储异常统一 500，不泄露异常内容', async () => {
    for (const method of ['countSince', 'insert', 'removeOwn']) {
      const h = harness()
      h.deps.store[method] = async () => { throw new Error('private-storage-detail') }
      const response = method === 'removeOwn' ? await h.withdraw('1794050000000-abcdef12') : await h.submit()
      assert.deepStrictEqual(response, expected(500, 'server'))
      assert.ok(!JSON.stringify(response).includes('private-storage-detail'))
    }
  })
  await test('parseEvent 解析 Buffer 外层和普通字符串正文', () => {
    const parsed = parseEvent(Buffer.from(event()))
    assert.strictEqual(parsed.method, 'POST')
    assert.strictEqual(parsed.path, '/api/requests')
    assert.deepStrictEqual(JSON.parse(parsed.body), input)
  })
  await test('parseEvent 解析 base64 正文并拒绝损坏的编码', () => {
    const parsed = parseEvent(event(input, '/api/requests', true))
    assert.ok(Buffer.isBuffer(parsed.body))
    assert.deepStrictEqual(JSON.parse(parsed.body.toString('utf8')), input)
    const broken = JSON.parse(event())
    broken.isBase64Encoded = true
    assert.throws(() => parseEvent(JSON.stringify(broken)))
  })
  await test('FC 返回 HTTP 封装，日志只有路径、状态码、耗时', async () => {
    const h = entryHarness()
    const response = await h.handler(Buffer.from(event(input, '/api/requests', true)), {})
    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.headers['content-type'], 'application/json; charset=utf-8')
    assert.strictEqual(JSON.parse(response.body).ok, true)
    const log = JSON.parse(h.logs[0])
    assert.deepStrictEqual(Object.keys(log).sort(), ['path', 'statusCode', 'durationMs'].sort())
    assert.strictEqual(log.path, '/api/requests')
    assert.strictEqual(log.statusCode, 200)
    assert.ok(log.durationMs >= 0)
    await h.handler(event(input, '/private-content?code=private-content'), {})
    assert.ok(!h.logs.join('').includes('private-content'))
    assert.ok(!h.logs.join('').includes('fake-code'))
    assert.ok(!h.logs.join('').includes('四餐'))
  })
  await test('缺少任一环境变量时所有路由均 500，只记录变量名', async () => {
    for (const key of ['WX_APPID', 'WX_SECRET', 'OTS_ENDPOINT', 'OTS_INSTANCE', 'OTS_TABLE']) {
      const env = entryHarness().env
      delete env[key]
      const h = entryHarness({ env, exchangeCode: () => assert.fail('不应认证'), makeStore: () => assert.fail('不应建客户端') })
      for (const path of ['/api/requests', '/api/requests/withdraw', '/missing']) {
        const response = await h.handler(event(input, path), {})
        assert.strictEqual(response.statusCode, 500)
        assert.deepStrictEqual(JSON.parse(response.body), { ok: false, code: 'server' })
      }
      assert.ok(h.logs.includes('缺少环境变量 ' + key))
      assert.ok(!h.logs.join('').includes('fake-'))
    }
  })
  await test('损坏外层事件返回 400；客户端初始化异常返回 500', async () => {
    const h = entryHarness()
    for (const bad of ['{', '{}', 'null', Buffer.from('[]')]) {
      const response = await h.handler(bad, {})
      assert.strictEqual(response.statusCode, 400)
      assert.deepStrictEqual(JSON.parse(response.body), { ok: false, code: 'invalid' })
    }
    const failing = entryHarness({ makeStore: () => { throw new Error('private-init-detail') } })
    const response = await failing.handler(event(), {})
    assert.strictEqual(response.statusCode, 500)
    assert.deepStrictEqual(JSON.parse(response.body), { ok: false, code: 'server' })
    assert.ok(!failing.logs.join('').includes('private-init-detail'))
  })
  await test('FC 的 base64 正文按解码后字节数限制', async () => {
    const h = entryHarness()
    const response = await h.handler(event({ ...input, padding: '字'.repeat(3000) }, '/api/requests', true), {})
    assert.strictEqual(response.statusCode, 413)
  })
  await test('微信替身只返回 openid，忽略其他响应字段', async () => {
    const result = await code2openid('fake-code', { appid: 'fake-app', secret: 'fake-secret', httpsGet: fakeGet(JSON.stringify({ openid: 'fake-openid', extra: 'private-extra' })) })
    assert.strictEqual(result, 'fake-openid')
  })
  await test('微信 errcode、非法 JSON、非 200 和连接异常均安全失败', async () => {
    for (const httpsGet of [fakeGet('{"errcode":40029,"errmsg":"private-auth-detail"}'), fakeGet('{'), fakeGet('{}'), fakeGet('{}', 500), () => { throw new Error('private-network-detail') }]) {
      await assert.rejects(code2openid('fake-code', { appid: 'fake-app', secret: 'fake-secret', httpsGet }), error => {
        assert.deepStrictEqual(error, { code: 'auth' })
        return true
      })
    }
  })
  await test('微信身份交换在 5 秒总时限后销毁请求', async () => {
    let destroyed = false
    const httpsGet = () => Object.assign(new EventEmitter(), { destroy() { destroyed = true } })
    await assert.rejects(code2openid('fake-code', { appid: 'fake-app', secret: 'fake-secret', httpsGet }), error => error.code === 'auth')
    assert.strictEqual(destroyed, true)
  })
  await test('表存储使用运行时临时凭证和默认表名，分页保持同一用户范围', async () => {
    const h = fakeSDK()
    assert.strictEqual(h.config.accessKeyId, h.credentials.accessKeyId)
    assert.strictEqual(h.config.secretAccessKey, h.credentials.accessKeySecret)
    assert.strictEqual(h.config.stsToken, h.credentials.securityToken)
    const continuation = [{ openid: 'fake-user' }, { id: '1794050000001-abcdef12' }]
    h.options.pages.push({ rows: [{}, {}], nextStartPrimaryKey: continuation }, { rows: [{}], nextStartPrimaryKey: [] })
    assert.strictEqual(await h.store.countSince('fake-user', 100), 3)
    assert.deepStrictEqual(h.calls[0].params.inclusiveStartPrimaryKey, [{ openid: 'fake-user' }, { id: '0000000000100' }])
    assert.deepStrictEqual(h.calls[0].params.exclusiveEndPrimaryKey, [{ openid: 'fake-user' }, { id: 'infinity' }])
    assert.deepStrictEqual(h.calls[1].params.inclusiveStartPrimaryKey, continuation)
    assert.strictEqual(h.calls[0].params.tableName, 'requests')
  })
  await test('表存储写入条件、属性白名单和数值类型', async () => {
    const h = fakeSDK()
    const id = await h.store.insert('fake-user', { ...form, weight: 70.1, target: null, tdee: null, createdAt: clock, appVersion: '1.0.2', extra: 'private-extra' })
    const params = h.calls[0].params
    assert.match(id, /^\d{13}-[0-9a-f]{8}$/)
    assert.deepStrictEqual(params.primaryKey, [{ openid: 'fake-user' }, { id }])
    assert.strictEqual(params.condition.expectation, 'absent')
    const attributes = Object.assign({}, ...params.attributeColumns)
    assert.deepStrictEqual(attributes.createdAt, { integer: clock })
    assert.strictEqual(attributes.weight, 70.1)
    assert.ok(!('extra' in attributes) && !('target' in attributes) && !('tdee' in attributes))
  })
  await test('表存储撤回限定双主键，不存在返回 false，其他错误继续抛出', async () => {
    const h = fakeSDK()
    assert.strictEqual(await h.store.removeOwn('fake-user', '1794050000000-abcdef12'), true)
    assert.deepStrictEqual(h.calls[0].params.primaryKey, [{ openid: 'fake-user' }, { id: '1794050000000-abcdef12' }])
    assert.strictEqual(h.calls[0].params.condition.expectation, 'present')
    h.options.deleteError = { code: 'OTSConditionCheckFail' }
    assert.strictEqual(await h.store.removeOwn('fake-user', '1794050000000-abcdef12'), false)
    h.options.deleteError = new Error('private-delete-detail')
    await assert.rejects(h.store.removeOwn('fake-user', '1794050000000-abcdef12'))
    assert.throws(() => createTablestoreStore({ credentials: {} }), /缺少运行时凭证/)
  })
  console.log('全部通过：' + passed + ' 组（纯离线测试，未加载 Tablestore SDK）')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
