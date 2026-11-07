// 与 miniprogram/utils/tdee.js 保持一致。
const ACTIVITIES = [
  { key: 'sedentary', title: '久坐', desc: '基本不运动，办公室工作', factor: 1.2 },
  { key: 'light', title: '轻度', desc: '每周运动 1–3 天', factor: 1.375 },
  { key: 'moderate', title: '中度', desc: '每周运动 3–5 天', factor: 1.55 },
  { key: 'active', title: '高度', desc: '每周运动 6–7 天', factor: 1.725 },
  { key: 'very', title: '极高', desc: '体力劳动，或每天练两次', factor: 1.9 }
]
const GOALS = [
  { key: 'cut', title: '减脂', factor: 0.85 },
  { key: 'keep', title: '保持', factor: 1 },
  { key: 'bulk', title: '增肌', factor: 1.1 }
]
const PERSONAL = ['sex', 'age', 'height', 'weight', 'activity']

function asForm(form) {
  return form && typeof form === 'object' && !Array.isArray(form) ? form : {}
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim())
}

function validNumber(value, min, max, decimal) {
  if (typeof value !== 'string' && typeof value !== 'number') return false
  const text = String(value).trim()
  if (!(decimal ? /^\d+(?:\.\d)?$/ : /^\d+$/).test(text)) return false
  const n = Number(text)
  return Number.isFinite(n) && n >= min && n <= max
}

function personalErrors(form) {
  const errors = {}
  if (form.sex !== 'm' && form.sex !== 'f') errors.sex = '请选择性别'
  if (!validNumber(form.age, 10, 100, false)) errors.age = '年龄请输入 10–100 之间的整数'
  if (!validNumber(form.height, 100, 250, false)) errors.height = '身高请输入 100–250 之间的整数'
  if (!validNumber(form.weight, 30, 300, true)) errors.weight = '体重请输入 30–300 之间的数，最多 1 位小数'
  if (!ACTIVITIES.some(item => item.key === form.activity)) errors.activity = '请选择运动习惯'
  return errors
}

function round10(value) {
  return Math.round(value / 10) * 10
}

function bmr(form) {
  form = asForm(form)
  const errors = personalErrors(form)
  if (['sex', 'age', 'height', 'weight'].some(key => errors[key])) return null
  return 10 * Number(form.weight) + 6.25 * Number(form.height) - 5 * Number(form.age) + (form.sex === 'm' ? 5 : -161)
}

function tdee(form) {
  form = asForm(form)
  if (Object.keys(personalErrors(form)).length) return null
  const activity = ACTIVITIES.find(item => item.key === form.activity)
  return round10(bmr(form) * activity.factor)
}

function target(form) {
  form = asForm(form)
  const kcal = tdee(form)
  const goal = GOALS.find(item => item.key === form.goal)
  return kcal === null || !goal ? null : round10(kcal * goal.factor)
}

function validate(form) {
  form = asForm(form)
  const filled = PERSONAL.filter(key => !isBlank(form[key])).length
  const mode = filled ? 'full' : 'message'
  const errors = filled ? personalErrors(form) : {}
  if (filled && filled < PERSONAL.length) errors.form = '请把我的情况填完整，或者都不填、只写留言'
  if (!isBlank(form.goal) && !GOALS.some(item => item.key === form.goal)) errors.goal = '请选择有效的目标'
  if (!isBlank(form.message) && typeof form.message !== 'string') errors.message = '留言请填写文字'
  else if (typeof form.message === 'string' && form.message.length > 300) errors.message = '留言最多 300 字'
  else if (!filled && isBlank(form.message)) errors.message = '请写下留言，或者填写完整的个人信息'
  return { ok: Object.keys(errors).length === 0, mode, errors }
}

// 校验、清洗和计算核心原样迁移，服务端独立部署。
function clean(form) {
  form = asForm(form)
  const result = {
    sex: form.sex === 'm' || form.sex === 'f' ? form.sex : '',
    age: validNumber(form.age, 10, 100, false) ? Number(form.age) : '',
    height: validNumber(form.height, 100, 250, false) ? Number(form.height) : '',
    weight: validNumber(form.weight, 30, 300, true) ? Number(form.weight) : '',
    activity: ACTIVITIES.some(item => item.key === form.activity) ? form.activity : '',
    goal: GOALS.some(item => item.key === form.goal) ? form.goal : '',
    message: typeof form.message === 'string' ? form.message.trim().slice(0, 300) : ''
  }
  return Object.assign(result, { tdee: tdee(result), target: target(result) })
}

module.exports = { validate, tdee, target, clean }
