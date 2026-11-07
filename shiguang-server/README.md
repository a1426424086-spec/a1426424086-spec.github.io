# 食光定制需求接口（FC 3.0 + Tablestore）

本目录可独立打包。目标运行时为阿里云函数计算 FC 3.0 的 Node.js 20 内置运行时，入口 `index.handler`。这一轮只写文件、做离线测试，尚未安装 SDK、部署或连接微信和阿里云；HTTP 事件格式和 SDK 行为仍需部署后联调确认。

## 本地测试

不安装依赖也能运行：

```sh
node test/api.test.js
```

测试使用内存存储、身份交换替身及 SDK 接口替身，不加载 `tablestore` 包、不发出网络请求、不改环境变量。`src/logic.js` 的校验、清洗和计算规则与小程序保持一致。前端测试在仓库根目录运行 `node miniprogram/tests/request.test.js`。

## 创建表格存储

1. 建议地域为「华东1（杭州）」，FC 和 Tablestore 放在同一地域。
2. 创建 Tablestore 实例，创建表 `requests`，依次添加主键 `openid`（STRING）、`id`（STRING），不启用自增主键。保留时间设为永久（TTL 为 -1），最大版本数设为 1。
3. 属性列由写入时自动产生：`sex age height weight activity goal message tdee target appVersion createdAt`。其中 `createdAt` 是毫秒时间戳；整数转为 SDK 的 64 位整数，体重可为小数。仅留言时估算值为 null，Tablestore 不支持 null 属性，因此不写入 `tdee` / `target`，读取时缺失即代表未估算。
4. `id` 为 13 位毫秒时间戳、连字符及 8 位随机十六进制字符。同一 openid 下按 id 排序即可按时间查看。后台查看使用 Tablestore 控制台。

## 创建 FC 函数

1. 在同地域创建 Node.js 20 函数，handler 填 `index.handler`，函数超时建议 15 秒。
2. 添加 HTTP 触发器，认证方式选择「无需认证」，允许 POST。业务身份通过每次 `wx.login` 获得的一次性 code 换取，不信任客户端传入的 openid。
3. 配置以下 5 个环境变量。这里仅列变量名和含义，不提供任何真实值。

| 变量 | 配置内容 |
| --- | --- |
| `WX_APPID` | 对应小程序的 AppID |
| `WX_SECRET` | 对应小程序的 AppSecret |
| `OTS_ENDPOINT` | 实例控制台给出的访问 Endpoint |
| `OTS_INSTANCE` | Tablestore 实例名 |
| `OTS_TABLE` | `requests` |

生产入口要求这 5 项全部存在，否则每个请求返回 500 `server`，日志仅提示缺少的变量名。存储适配器单独使用时表名默认 `requests`；生产仍须显式填写 `OTS_TABLE`。

4. 绑定供 FC 扮演的 RAM 角色，信任主体为 FC 服务。只授予下面 3 项动作，将资源限定到该实例的该表。尖括号内全部是占位符，须由部署者在控制台替换；不要把填入真实值的策略文件提交到公开仓库。

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ots:GetRange", "ots:PutRow", "ots:DeleteRow"],
    "Resource": ["acs:ots:<REGION_ID>:<ACCOUNT_ID>:instance/<INSTANCE_NAME>/table/<TABLE_NAME>"]
  }]
}
```

无需给运行角色建实例、建表、列举其他表或管理账号的权限。SDK 凭证仅取自本次调用的 `context.credentials`（临时身份和安全令牌），不在文件或自定义环境变量里放固定访问凭证。

5. 按已有网络安排选择 FC 可达的同地域 Tablestore Endpoint，优先使用同地域内网访问。函数还须能访问微信官方身份交换接口。本说明不自动调整任何网络、代理、DNS、出口或防护；不可达时交由部署者处理。

AppSecret 只能由用户直接填入 FC 环境变量，不写进代码，不提交 GitHub，不发到聊天里。函数不保存、返回或记录微信会话密钥；正常应用日志仅包含路由类别、HTTP 状态码和耗时，未知路径会脱敏。不要额外开启请求正文或凭证日志。

## 打包与上传（后续获准部署时执行）

本轮不执行以下安装、打包上传步骤。部署者获准后，在本目录安装生产依赖并打包：

```sh
npm install --omit=dev
zip -r ../shiguang-request-api.zip index.js src package.json package-lock.json node_modules
```

将 zip 上传到 FC；zip 根目录应直接包含 `index.js`。测试目录不必上传。压缩包和 `node_modules` 不提交公开仓库。

`parseEvent` 集中处理 HTTP 触发器事件：外层为 JSON 字符串或 Buffer，路由取 `rawPath`，方法取 `requestContext.http.method`，正文取 `body`，按 `isBase64Encoded` 解码。联调时核对实际事件字段；若格式不同，只调整这一层并补测试，不记录原始请求正文。

## 开发联调与正式域名

小程序 `miniprogram/config/api.js` 当前保持 `API_BASE: ''`，显示「提交功能还没开通，可以先私信作者」，隐藏撤回入口。开发期由 Claude 将 FC 默认 HTTP 测试地址填到本地配置，地址不带末尾斜杠，勿将真实测试地址提交公开仓库。开发者工具域名校验及真机调试由后续联调人员按获准范围操作，本轮不运行开发者工具。

域名备案后，给 FC 绑定自定义域名、配置 HTTPS 证书，将 CNAME 指向 FC 公网 Endpoint，并将 `/api/requests` 与 `/api/requests/withdraw` 路由到本函数；然后在小程序后台加入 request 合法域名，最后将 `API_BASE` 换为已备案的 HTTPS 域名。上线前按方案补齐个人信息用途及阿里云存储方的隐私指引。

## 接口和验收注意事项

| 请求 | 正文 | 成功 |
| --- | --- | --- |
| `POST /api/requests` | `{ code, form, appVersion }` | 200 `{ ok: true, id, createdAt }` |
| `POST /api/requests/withdraw` | `{ code, id }` | 200 `{ ok: true }` |

失败统一为 `{ ok: false, code }`：400 `invalid`（表单或 JSON 无效）、413 `invalid`（正文超过 8192 个 UTF-8 字节）、401 `auth`、429 `limit`、404 `not_found` / `bad_action`、500 `server`。不向调用者透传异常内容。微信身份交换总超时 5 秒，小程序请求超时 8 秒；每次提交和撤回重新登录取 code。

每日计数以固定 UTC+8 的零点为界；同一 openid 当日现存记录达到 3 条时拒绝下一次提交。与原实现一致，撤回删除后不再计入次数。计数与插入是两个操作，并发请求仍可能同时通过计数；当前按任务指定的三个存储方法迁移，未引入事务计数器。真机联调须检查提交、失败提示、撤回归属和跨日行为；本地替身通过不等于 FC 实测通过。
