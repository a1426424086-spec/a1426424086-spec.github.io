const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const T = require('../utils/tdee')
const L = require('../cloudfunctions/request/logic')

const male = { sex: 'm', age: 30, height: 175, weight: 70, activity: 'moderate' }
const female = { sex: 'f', age: 25, height: 160, weight: 50, activity: 'sedentary' }
const copy = value => JSON.parse(JSON.stringify(value))
let passed = 0

async function test(name, run) {
  await run()
  passed += 1
  console.log('通过：' + name)
}

// 只注入本地替身；此文件不会载入云 SDK，也不会连接微信或数据库。
function loadScript(file, globals) {
  const sandbox = Object.assign({ module: { exports: {} }, exports: {} }, globals)
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file })
  return sandbox
}

function pageHarness(env, initial = {}) {
  const storage = copy(initial)
  const calls = []
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
    cloud: { callFunction: async options => { calls.push(copy(options)); return { result: { ok: true, id: 'test-record', createdAt: 1794043800000 } } } }
  }
  loadScript('pages/request/index.js', {
    wx,
    require: name => name === '../../utils/tdee' ? T : { ENV_ID: env },
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
  return { page, wx, storage, calls, toasts, waitModal: () => pending, cancelModal: () => { confirm = false } }
}

function cloudHarness(options = {}) {
  const queries = []
  const writes = []
  const db = {
    command: { gte: date => ({ gte: date.getTime() }) },
    serverDate: () => 'server-time',
    collection: name => {
      assert.strictEqual(name, 'requests')
      return {
        where: query => {
          queries.push(copy(query))
          return {
            count: async () => {
              if (options.error === 'count') throw new Error('private-server-detail')
              return { total: options.count || 0 }
            },
            remove: async () => {
              if (options.error === 'remove') throw new Error('private-server-detail')
              return { stats: { removed: query.openid === 'test-caller' && query._id === 'test-owned' ? 1 : 0 } }
            }
          }
        },
        add: async value => {
          if (options.error === 'add') throw new Error('private-server-detail')
          writes.push(copy(value.data))
          return { _id: 'test-record' }
        }
      }
    }
  }
  const sdk = {
    DYNAMIC_CURRENT_ENV: 'test-current',
    init: arg => {
      assert.strictEqual(arg.env, 'test-current')
      if (options.error === 'init') throw new Error('private-server-detail')
    },
    getWXContext: () => ({ OPENID: options.noIdentity ? '' : 'test-caller' }),
    database: () => db
  }
  class Clock extends Date {
    static now() { return options.now || Date.parse('2026-11-07T16:00:00Z') }
  }
  const sandbox = loadScript('cloudfunctions/request/index.js', {
    Date: Clock,
    require: name => name === 'wx-server-sdk' ? sdk : L
  })
  return { main: sandbox.exports.main, queries, writes }
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
    const back = fs.readFileSync(path.join(__dirname, '../cloudfunctions/request/logic.js'), 'utf8').split('// 与 utils/tdee.js')[0]
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

  await test('云端清洗保留白名单、去空白、截到 300 字', () => {
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

  await test('环境编号为空：只有友好提示，表单和草稿仍可用', async () => {
    const h = pageHarness('', { sg_request_last: { id: 'test-old', createdAt: 1794043800000 } })
    delete h.wx.cloud
    h.page.updateField('age', '9')
    assert.ok(h.page.data.errors.age)
    assert.strictEqual(h.storage.sg_request_draft.age, '9')
    assert.strictEqual(h.page.data.cloudEnabled, false)
    await h.page.submit()
    h.page.withdraw()
    assert.deepStrictEqual(h.toasts, ['提交功能还没开通，可以先私信作者'])
    assert.strictEqual(h.calls.length, 0)
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
    const h = pageHarness('test-env')
    h.page.updateField('sex', 'm')
    await h.page.submit()
    assert.strictEqual(h.calls.length, 0)
    assert.strictEqual(h.page.data.submitError, '请把我的情况填完整，或者都不填、只写留言')
    h.page.data.form = { ...male, message: '想要四餐', goal: 'cut' }
    await h.page.submit()
    assert.strictEqual(h.calls.length, 1)
    assert.strictEqual(h.calls[0].timeout, 8000)
    assert.strictEqual(h.calls[0].data.appVersion, '1.0.2')
    assert.strictEqual(h.storage.sg_request_last.id, 'test-record')
    assert.strictEqual(h.storage.sg_request_draft.message, '')
    assert.strictEqual(h.storage.sg_request_draft.weight, 70)
    assert.strictEqual(h.page.data.submitting, false)
    assert.strictEqual(h.toasts.pop(), '已提交，作者看到后会联系你')
  })

  await test('提交防重入及失败提示，失败保留草稿', async () => {
    const h = pageHarness('test-env', { sg_request_draft: { message: '留言' } })
    let release
    h.wx.cloud.callFunction = options => {
      h.calls.push(options)
      return new Promise(resolve => { release = resolve })
    }
    const first = h.page.submit()
    assert.strictEqual(h.page.data.submitting, true)
    await h.page.submit()
    assert.strictEqual(h.calls.length, 1)
    release({ result: { ok: false, code: 'limit' } })
    await first
    assert.strictEqual(h.toasts.pop(), '今天已经提交 3 次了，明天再来，或者直接私信作者')
    assert.strictEqual(h.page.data.form.message, '留言')
    for (const [code, expected] of [['invalid', '填写的内容有误，请检查'], ['server', '网络不稳定，稍后再试']]) {
      h.wx.cloud.callFunction = async () => ({ result: { ok: false, code } })
      await h.page.submit()
      assert.strictEqual(h.toasts.pop(), expected)
    }
    h.wx.cloud.callFunction = async () => { throw new Error('offline-test') }
    await h.page.submit()
    assert.strictEqual(h.toasts.pop(), '网络不稳定，稍后再试')
    assert.strictEqual(h.page.data.submitting, false)
  })

  await test('撤回确认、取消、成功清除本机记录', async () => {
    const initial = { sg_request_last: { id: 'test-record', createdAt: 1794043800000 } }
    const h = pageHarness('test-env', initial)
    h.page.withdraw()
    await h.waitModal()
    assert.strictEqual(h.calls[0].data.action, 'withdraw')
    assert.strictEqual(h.calls[0].data.id, 'test-record')
    assert.strictEqual(h.storage.sg_request_last, undefined)
    assert.strictEqual(h.page.data.last, null)
    assert.strictEqual(h.toasts.pop(), '已撤回')
    const cancel = pageHarness('test-env', initial)
    cancel.cancelModal()
    cancel.page.withdraw()
    await cancel.waitModal()
    assert.strictEqual(cancel.calls.length, 0)
    assert.ok(cancel.storage.sg_request_last)
    assert.strictEqual(cancel.page.data.withdrawing, false)
  })

  await test('云端提交使用调用者身份、服务端时间和白名单', async () => {
    const h = cloudHarness({ count: 2 })
    const result = await h.main({ action: 'submit', form: { ...male, message: '', openid: 'forged', extra: true }, appVersion: '1.0.2' })
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.id, 'test-record')
    assert.strictEqual(h.writes[0].openid, 'test-caller')
    assert.strictEqual(h.writes[0].createdAt, 'server-time')
    assert.strictEqual(h.writes[0].appVersion, '1.0.2')
    assert.strictEqual(h.writes[0].extra, undefined)
    assert.strictEqual(h.writes[0].tdee, 2560)
  })

  await test('北京时间跨日边界与当天三条限制', async () => {
    for (const [now, start] of [['2026-11-07T15:59:59Z', '2026-11-06T16:00:00Z'], ['2026-11-07T16:00:00Z', '2026-11-07T16:00:00Z']]) {
      const h = cloudHarness({ now: Date.parse(now), count: 3 })
      assert.deepStrictEqual(copy(await h.main({ action: 'submit', form: male })), { ok: false, code: 'limit' })
      assert.strictEqual(h.queries[0].createdAt.gte, Date.parse(start))
      assert.strictEqual(h.queries[0].openid, 'test-caller')
      assert.strictEqual(h.writes.length, 0)
    }
  })

  await test('云端撤回同时限定记录和调用者，拒绝非字符串 id', async () => {
    const h = cloudHarness()
    assert.deepStrictEqual(copy(await h.main({ action: 'withdraw', id: 'test-owned', openid: 'forged' })), { ok: true })
    assert.deepStrictEqual(h.queries[0], { _id: 'test-owned', openid: 'test-caller' })
    assert.deepStrictEqual(copy(await h.main({ action: 'withdraw', id: 'test-other' })), { ok: false, code: 'not_found' })
    const count = h.queries.length
    assert.strictEqual((await h.main({ action: 'withdraw', id: {} })).code, 'not_found')
    assert.strictEqual(h.queries.length, count)
  })

  await test('未知操作、无效表单和异常都返回安全结果', async () => {
    const h = cloudHarness()
    assert.strictEqual((await h.main({ action: 'other' })).code, 'bad_action')
    assert.strictEqual((await h.main(null)).code, 'bad_action')
    assert.strictEqual((await h.main({ action: 'submit', form: { sex: 'm' } })).code, 'invalid')
    assert.strictEqual(h.queries.length, 0)
    assert.strictEqual((await cloudHarness({ noIdentity: true }).main({ action: 'submit', form: male })).code, 'server')
    for (const error of ['init', 'count', 'add', 'remove']) {
      const failing = cloudHarness({ error })
      const event = error === 'remove' ? { action: 'withdraw', id: 'test-owned' } : { action: 'submit', form: male }
      assert.deepStrictEqual(copy(await failing.main(event)), { ok: false, code: 'server' })
    }
  })

  await test('应用启动仅在环境非空且 SDK 存在时初始化云', () => {
    for (const [env, supported, expected] of [['', false, 0], ['', true, 0], ['test-env', false, 0], ['test-env', true, 1]]) {
      let app
      let initialized = 0
      let storeInitialized = 0
      const wx = { showToast: () => {} }
      if (supported) wx.cloud = { init: options => {
        initialized += 1
        assert.strictEqual(options.env, env)
        assert.strictEqual(options.traceUser, false)
      } }
      loadScript('app.js', {
        wx,
        App: value => { app = value },
        require: name => name === './utils/store' ? { init: () => { storeInitialized += 1 } } : { ENV_ID: env }
      })
      app.onLaunch()
      assert.strictEqual(initialized, expected)
      assert.strictEqual(storeInitialized, 1)
    }
  })
  console.log('全部通过：' + passed + ' 组（离线替身测试，未连接真实云环境）')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
