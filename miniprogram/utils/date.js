const WEEK = ['日', '一', '二', '三', '四', '五', '六']

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function format(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function parse(s) {
  const parts = s.split('-').map(Number)
  return new Date(parts[0], parts[1] - 1, parts[2])
}

function isValid(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && format(parse(s)) === s
}

function today() {
  return format(new Date())
}

function addDays(s, n) {
  const d = parse(s)
  d.setDate(d.getDate() + n)
  return format(d)
}

function nowTime() {
  const d = new Date()
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function weekday(s) {
  return '周' + WEEK[parse(s).getDay()]
}

// 2026 / 10 / 28
function slash(s) {
  return s.split('-').join(' / ')
}

// 10月28日
function short(s) {
  const d = parse(s)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

// 今天 / 昨天 / 明天 / 10月28日
function relative(s) {
  const t = today()
  if (s === t) return '今天'
  if (s === addDays(t, -1)) return '昨天'
  if (s === addDays(t, 1)) return '明天'
  return short(s)
}

const CN = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
function cnNumber(n) {
  if (n <= 10) return CN[n]
  if (n < 20) return '十' + CN[n % 10]
  return CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : '')
}

// 十一月一日
function chinese(s) {
  const d = parse(s)
  return cnNumber(d.getMonth() + 1) + '月' + cnNumber(d.getDate()) + '日'
}

// 按当前时刻问候
function greeting() {
  const h = new Date().getHours()
  if (h >= 5 && h < 10) return '早上好'
  if (h >= 10 && h < 13) return '中午好'
  if (h >= 13 && h < 18) return '下午好'
  if (h >= 18 && h < 23) return '晚上好'
  return '夜深了'
}

module.exports = { chinese, greeting, pad, format, parse, isValid, today, addDays, nowTime, weekday, slash, short, relative }
