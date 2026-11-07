const { randomBytes } = require('crypto')

const COLUMNS = ['sex', 'age', 'height', 'weight', 'activity', 'goal', 'message', 'tdee', 'target', 'appVersion', 'createdAt']

function createTablestoreStore({ credentials, env = process.env, sdk } = {}) {
  if (!credentials || !credentials.accessKeyId || !credentials.accessKeySecret || !credentials.securityToken) {
    throw new Error('缺少运行时凭证')
  }
  // 延迟加载，业务测试和事件解析无需安装 SDK。
  const TableStore = sdk || require('tablestore')
  const client = new TableStore.Client({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.accessKeySecret,
    stsToken: credentials.securityToken,
    endpoint: env.OTS_ENDPOINT,
    instancename: env.OTS_INSTANCE
  })
  const tableName = env.OTS_TABLE || 'requests'
  const call = (method, params) => new Promise((resolve, reject) => {
    client[method](params, (error, data) => error ? reject(error) : resolve(data))
  })
  const primaryKey = (openid, id) => [{ openid }, { id }]

  return {
    async countSince(openid, sinceMs) {
      let start = primaryKey(openid, String(sinceMs).padStart(13, '0'))
      let count = 0
      do {
        const page = await call('getRange', {
          tableName,
          direction: TableStore.Direction.FORWARD,
          inclusiveStartPrimaryKey: start,
          exclusiveEndPrimaryKey: primaryKey(openid, TableStore.INF_MAX),
          maxVersions: 1,
          columnsToGet: []
        })
        count += page.rows.length
        start = page.nextStartPrimaryKey
      } while (start && start.length)
      return count
    },
    async insert(openid, doc) {
      const id = String(doc.createdAt).padStart(13, '0') + '-' + randomBytes(4).toString('hex')
      const attributeColumns = COLUMNS.filter(key => doc[key] !== null && doc[key] !== undefined).map(key => ({
        [key]: Number.isInteger(doc[key]) ? TableStore.Long.fromNumber(doc[key]) : doc[key]
      }))
      await call('putRow', {
        tableName,
        primaryKey: primaryKey(openid, id),
        condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
        attributeColumns
      })
      return id
    },
    async removeOwn(openid, id) {
      try {
        await call('deleteRow', {
          tableName,
          primaryKey: primaryKey(openid, id),
          condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, null)
        })
        return true
      } catch (error) {
        if (error.code === 'OTSConditionCheckFail') return false
        throw error
      }
    }
  }
}

module.exports = { createTablestoreStore }
