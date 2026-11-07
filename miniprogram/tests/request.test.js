const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const T = require('../utils/tdee')
const L = require('../../shiguang-server/src/logic')

const male = { sex: 'm', age: 30, height: 175, weight: 70, activity: 'moderate' }
const female = { sex: 'f', age: 25, height: 160, weight: 50, activity: 'sedentary' }
const copy = value => JSON.parse(JSON.stringify(value))
let passed = 0
async function test(name, run) {
  await run()
  passed += 1
  console.log('通过：' + name)
}

// 只注入本地替身，不请求网络，不加载存储 SDK。
function loadScript(file, globals) {
  const sandbox = Object.assign({ module: { exports: {} }, exports: {} }, globals)
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file })
  return sandbox
}

function pageHarness(apiBase, initial = {}) {
  const storage = copy(initial)
  const calls = []
  const logins = []
  const toasts = []
  let config
  let pending
  let confirm = true
  const wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = copy(value) },
    removeStorageSync: key => { delete storage[key] },
    showToast: options => toasts.push(options.title),
    showModal: options => { pending = options.success({ confirm }) },
    login: options => { logins.push(options); options.success({ code: 'fake-code-' + logins.length }) },
    request: options => {
      calls.push(copy(options))
      options.success({ statusCode: 200, data: { ok: true, id: '1794043800000-abcdef12', createdAt: 1794043800000 } })
    }
  }
  loadScript('pages/request/index.js', {
    wx,
    require: name => name === '../../utils/tdee' ? T : { API_BASE: apiBase },
    Page: value => { config = value }
  })
  const page = Object.assign({}, config, { data: copy(config.data) })
  page.setData = patch => {
    Object.keys(patch).forEach(key => {
      const keys = key.split('.')
      if (keys.length === 2) page.data[keys[0]][keys[1]] = patch[key]
      else page.data[key] = patch[key]
    })
  }
  page.onLoad()
  return { page, wx, storage, calls, logins, toasts, waitModal: () => pending, cancelModal: () => { confirm = false } }
}

async function main() {
  await test('男女消耗和三个目标按 10 千卡取整', () => {
    assert.strictEqual(T.bmr(male), 1648.75)
    assert.strictEqual(T.tdee(male), 2560)
    assert.strictEqual(T.tdee(female), 1460)
    assert.strictEqual(T.target({ ...male, goal: 'cut' }), 2180)
    assert.strictEqual(T.target({ ...male, goal: 'keep' }), 2560)
    assert.strictEqual(T.target({ ...male, goal: 'bulk' }), 2820)
    assert.strictEqual(T.target(male), null)
    assert.strictEqual(T.tdee({ ...male, age: '' }), null)
    assert.strictEqual(T.tdee({ ...male, weight: 70.11 }), null)
  })

  await test('完整信息、仅留言、部分信息三种提交条件', () => {
    assert.deepStrictEqual(T.validate(male), { ok: true, mode: 'full', errors: {} })
    assert.deepStrictEqual(T.validate({ message: '不吃牛肉' }), { ok: true, mode: 'message', errors: {} })
    assert.deepStrictEqual(T.validate({ message: '想要四餐', goal: 'cut' }), { ok: true, mode: 'message', errors: {} })
    assert.strictEqual(T.validate({ sex: 'm', message: '想要四餐' }).ok, false)
    assert.strictEqual(T.validate({ sex: 'm' }).errors.form, '请把我的情况填完整，或者都不填、只写留言')
    assert.strictEqual(T.validate({ message: '   ' }).ok, false)
  })

  await test('数值边界、整数和小数位、异常字段类型', () => {
    for (const [key, values] of Object.entries({ age: [9, 101, 30.5, '30岁', true], height: [99, 251, 175.5, [], {}], weight: [29.9, 300.1, 70.01, Infinity, '70kg'] })) {
      values.forEach(value => assert.strictEqual(T.validate({ ...male, [key]: value }).ok, false))
    }
    ;[{ age: 10, height: 100, weight: 30 }, { age: 100, height: 250, weight: 300 }, { weight: '70.1' }].forEach(values => {
      assert.strictEqual(T.validate({ ...male, ...values }).ok, true)
    })
    ;[{ sex: 'x' }, { activity: 'unknown' }, { goal: 'unknown' }, { message: {} }, { message: '字'.repeat(301) }].forEach(values => {
      assert.strictEqual(T.validate({ ...male, ...values }).ok, false)
    })
    ;[null, undefined, [], 'text'].forEach(value => assert.strictEqual(T.validate(value).ok, false))
  })

  await test('前后端核心逐字相同，边界输入的校验和估算一致', () => {
    const front = fs.readFileSync(path.join(__dirname, '../utils/tdee.js'), 'utf8').split('module.exports = ')[0]
    const back = fs.readFileSync(path.join(__dirname, '../../shiguang-server/src/logic.js'), 'utf8').split('\n').slice(1).join('\n').split('// 校验、清洗')[0]
    assert.strictEqual(back, front)
    const cases = [male, female, {}, { message: '留言' }, { sex: 'm' }, null, []]
    for (const key of ['sex', 'age', 'height', 'weight', 'activity', 'goal', 'message']) {
      for (const value of ['', null, {}, [], true, NaN, -1, 10, 30, 100, 250, 300, '70.1', '字'.repeat(301)]) cases.push({ ...male, [key]: value })
    }
    cases.forEach(form => {
      assert.deepStrictEqual(L.validate(form), T.validate(form))
      assert.strictEqual(L.tdee(form), T.tdee(form))
    })
  })

  await test('服务端清洗保留白名单、去空白、截到 300 字', () => {
    const original = { ...male, age: '30', goal: 'cut', message: '  ' + '字'.repeat(350) + '  ', extra: true, openid: 'forged', tdee: 1, target: 2 }
    const cleaned = L.clean(original)
    assert.deepStrictEqual(Object.keys(cleaned).sort(), ['sex', 'age', 'height', 'weight', 'activity', 'goal', 'message', 'tdee', 'target'].sort())
    assert.strictEqual(cleaned.message.length, 300)
    assert.strictEqual(cleaned.age, 30)
    assert.strictEqual(cleaned.tdee, 2560)
    assert.strictEqual(cleaned.target, 2180)
    assert.strictEqual(original.tdee, 1)
    const onlyMessage = L.clean({ message: '  留言  ' })
    assert.strictEqual(onlyMessage.message, '留言')
    assert.strictEqual(onlyMessage.tdee, null)
    assert.strictEqual(onlyMessage.target, null)
  })

  await test('空地址：提示未开通、隐藏撤回、表单草稿仍可用', async () => {
    const h = pageHarness('', { sg_request_last: { id: 'test-old', createdAt: 1794043800000 } })
    h.page.updateField('age', '9')
    assert.ok(h.page.data.errors.age)
    assert.strictEqual(h.storage.sg_request_draft.age, '9')
    assert.strictEqual(h.page.data.apiEnabled, false)
    assert.ok(fs.readFileSync(path.join(__dirname, '../pages/request/index.wxml'), 'utf8').includes('wx:if="{{apiEnabled}}"'))
    assert.strictEqual(require('../config/api').API_BASE, '')
    await h.page.submit()
    h.page.withdraw()
    assert.deepStrictEqual(h.toasts, ['提交功能还没开通，可以先私信作者'])
    assert.strictEqual(h.calls.length, 0)
    assert.strictEqual(h.logins.length, 0)
    assert.strictEqual(h.page.data.submitting, false)
  })

  await test('草稿恢复、实时估算、性别/活动/目标可取消', () => {
    const h = pageHarness('', { sg_request_draft: { ...male, goal: 'cut', message: '草稿' } })
    assert.strictEqual(h.page.data.kcal, 2560)
    assert.strictEqual(h.page.data.targetKcal, 2180)
    h.page.setGoal({ currentTarget: { dataset: { v: 'cut' } } })
    assert.strictEqual(h.page.data.goalIndex, -1)
    assert.strictEqual(h.page.data.targetKcal, null)
    h.page.setActivity({ currentTarget: { dataset: { v: 'moderate' } } })
    assert.strictEqual(h.page.data.form.activity, '')
    assert.strictEqual(h.page.data.kcal, null)
    h.page.setSex({ currentTarget: { dataset: { v: 'm' } } })
    assert.strictEqual(h.page.data.form.sex, '')
    assert.strictEqual(h.storage.sg_request_draft.message, '草稿')
  })

  await test('部分信息不发送；成功保存最近记录，只清留言', async () => {
    const h = pageHarness('fake-base')
    h.page.updateField('sex', 'm')
    await h.page.submit()
    assert.strictEqual(h.calls.length, 0)
    assert.strictEqual(h.logins.length, 0)
    assert.strictEqual(h.page.data.submitError, '请把我的情况填完整，或者都不填、只写留言')
    h.page.data.form = { ...male, message: '想要四餐', goal: 'cut' }
    await h.page.submit()
    assert.strictEqual(h.calls.length, 1)
    assert.strictEqual(h.logins.length, 1)
    assert.strictEqual(h.calls[0].url, 'fake-base/api/requests')
    assert.strictEqual(h.calls[0].method, 'POST')
    assert.strictEqual(h.calls[0].timeout, 8000)
    assert.strictEqual(h.calls[0].data.code, 'fake-code-1')
    assert.strictEqual(h.calls[0].data.appVersion, '1.0.2')
    assert.strictEqual(h.storage.sg_request_last.id, '1794043800000-abcdef12')
    assert.strictEqual(h.storage.sg_request_draft.message, '')
    assert.strictEqual(h.storage.sg_request_draft.weight, 70)
    assert.strictEqual(h.page.data.submitting, false)
    assert.strictEqual(h.toasts.pop(), '已提交，作者看到后会联系你')
  })

  await test('登录和请求期间均防重入，limit 提示并保留草稿', async () => {
    const h = pageHarness('fake-base', { sg_request_draft: { message: '留言' } })
    let finishLogin
    let finishRequest
    h.wx.login = options => { h.logins.push(options); finishLogin = options.success }
    h.wx.request = options => { h.calls.push(options); finishRequest = options.success }
    const first = h.page.submit()
    assert.strictEqual(h.page.data.submitting, true)
    await h.page.submit()
    assert.strictEqual(h.logins.length, 1)
    assert.strictEqual(h.calls.length, 0)
    finishLogin({ code: 'fake-code' })
    await Promise.resolve()
    await h.page.submit()
    h.page.updateField('message', '不可覆盖')
    assert.strictEqual(h.calls.length, 1)
    finishRequest({ statusCode: 429, data: { ok: false, code: 'limit' } })
    await first
    assert.strictEqual(h.toasts.pop(), '今天已经提交 3 次了，明天再来，或者直接私信作者')
    assert.strictEqual(h.page.data.form.message, '留言')
    assert.strictEqual(h.storage.sg_request_draft.message, '留言')
    assert.strictEqual(h.page.data.submitting, false)
  })

  await test('接口 auth、invalid、server 和非 2xx 无 code 的提示', async () => {
    const h = pageHarness('fake-base', { sg_request_draft: { message: '留言' } })
    for (const [statusCode, data, expected] of [
      [401, { code: 'auth' }, '登录失败，请稍后再试'],
      [400, { code: 'invalid' }, '填写的内容有误，请检查'],
      [500, { code: 'server' }, '网络不稳定，稍后再试'],
      [503, {}, '网络不稳定，稍后再试'],
      [500, { ok: true }, '网络不稳定，稍后再试'],
      [200, null, '网络不稳定，稍后再试']
    ]) {
      h.wx.request = options => options.success({ statusCode, data })
      await h.page.submit()
      assert.strictEqual(h.toasts.pop(), expected)
      assert.strictEqual(h.page.data.submitting, false)
      assert.strictEqual(h.page.data.form.message, '留言')
    }
  })

  await test('wx.login 失败、空 code 和同步异常提示登录失败', async () => {
    const h = pageHarness('fake-base', { sg_request_draft: { message: '留言' } })
    for (const login of [options => options.fail({}), options => options.success({}), () => { throw new Error('fake-login-error') }]) {
      h.wx.login = login
      await h.page.submit()
      assert.strictEqual(h.toasts.pop(), '登录失败，请稍后再试')
      assert.strictEqual(h.page.data.submitting, false)
    }
    assert.strictEqual(h.calls.length, 0)
  })

  await test('请求网络失败和超时保留草稿、恢复提交按钮', async () => {
    const h = pageHarness('fake-base', { sg_request_draft: { message: '留言' } })
    for (const errMsg of ['request:fail offline', 'request:fail timeout']) {
      h.wx.request = options => options.fail({ errMsg })
      await h.page.submit()
      assert.strictEqual(h.toasts.pop(), '网络不稳定，稍后再试')
      assert.strictEqual(h.page.data.submitting, false)
      assert.strictEqual(h.storage.sg_request_draft.message, '留言')
    }
  })

  await test('撤回确认、取消、成功清除本机记录，每次重新登录', async () => {
    const initial = { sg_request_last: { id: '1794043800000-abcdef12', createdAt: 1794043800000 } }
    const h = pageHarness('fake-base', initial)
    h.page.withdraw()
    h.page.withdraw()
    await h.waitModal()
    assert.strictEqual(h.logins.length, 1)
    assert.strictEqual(h.calls.length, 1)
    assert.strictEqual(h.calls[0].url, 'fake-base/api/requests/withdraw')
    assert.strictEqual(h.calls[0].method, 'POST')
    assert.strictEqual(h.calls[0].timeout, 8000)
    assert.deepStrictEqual(h.calls[0].data, { code: 'fake-code-1', id: initial.sg_request_last.id })
    assert.strictEqual(h.storage.sg_request_last, undefined)
    assert.strictEqual(h.page.data.last, null)
    assert.strictEqual(h.toasts.pop(), '已撤回')
    h.page.updateField('message', '新留言')
    await h.page.submit()
    assert.strictEqual(h.calls[1].data.code, 'fake-code-2')
    const cancel = pageHarness('fake-base', initial)
    cancel.cancelModal()
    cancel.page.withdraw()
    await cancel.waitModal()
    assert.strictEqual(cancel.calls.length, 0)
    assert.strictEqual(cancel.logins.length, 0)
    assert.ok(cancel.storage.sg_request_last)
    assert.strictEqual(cancel.page.data.withdrawing, false)
  })

  await test('撤回失败保留最近记录并恢复按钮', async () => {
    const initial = { sg_request_last: { id: '1794043800000-abcdef12', createdAt: 1794043800000 } }
    for (const [code, message] of [['not_found', '这次提交已不存在'], ['auth', '登录失败，请稍后再试'], ['server', '网络不稳定，稍后再试']]) {
      const h = pageHarness('fake-base', initial)
      h.wx.request = options => options.success({ statusCode: 404, data: { ok: false, code } })
      h.page.withdraw()
      await h.waitModal()
      assert.strictEqual(h.toasts.pop(), message)
      assert.ok(h.storage.sg_request_last)
      assert.strictEqual(h.page.data.withdrawing, false)
    }
  })

  await test('应用启动仍初始化本机存储并保留存储错误提示', () => {
    for (const fail of [false, true]) {
      let app
      let initialized = 0
      const toasts = []
      loadScript('app.js', {
        wx: { showToast: options => toasts.push(options.title) },
        App: value => { app = value },
        require: name => {
          assert.strictEqual(name, './utils/store')
          return { init: () => { initialized += 1; if (fail) throw new Error('fake-storage-error') } }
        }
      })
      app.onLaunch()
      assert.strictEqual(initialized, 1)
      assert.deepStrictEqual(toasts, fail ? ['本机存储不可用'] : [])
    }
  })
  console.log('全部通过：' + passed + ' 组（离线替身测试，未连接真实接口）')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
