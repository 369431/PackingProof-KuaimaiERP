# PackingProof 快麦 ERP 适配器（payload）

这是 `369431.kuaimai-erp` 扩展包的程序载荷。适配器是独立运行的 Node.js 程序，
不会被 PackingProof 加载或执行；安装扩展后由用户手动启动（`start.cmd` 或 `npm start`）。

## 运行要求

- Node.js 20 或更高版本
- 支持扩展 API v1 的 PackingProof Desktop（>= 0.0.63）

## 启动步骤

1. 在 PackingProof 的“设置 → 扩展与联动”中开启“启用扩展 API”
2. 复制 `.env.example` 为 `.env`，填写快麦开放平台 API 信息
3. 运行 `start.cmd`（或 `npm start`）
4. 首次运行时，在 PackingProof 弹出的授权窗口中批准适配器（申请 `scan-tasks.read`、
   `scan-results.write` 权限和 `order.lookup`、`refund.lookup` 能力）

## 扩展性

适配器核心（`src/adapter-core.js`）与 ERP 平台解耦。新增平台时：

1. 在 `src/providers/` 新建提供方文件，实现 `order-provider.js` 中的 OrderLookupProvider 契约
2. 在 `src/index.js` 的 `providers` 注册表中登记
3. 通过环境变量 `ERP_PROVIDER=<name>` 选择

## 配置项

| 配置项 | 必填 | 说明 |
| --- | --- | --- |
| `PACKINGPROOF_URL` | 否 | 默认 `http://127.0.0.1:5280` |
| `ERP_PROVIDER` | 否 | ERP 提供方，默认 `kuaimai` |
| `PACKINGPROOF_EXTENSION_INSTANCE_ID` | 否 | 固定扩展实例 ID（测试/工位绑定） |
| `KUAIMAI_APP_KEY` | 是 | 快麦应用 App Key |
| `KUAIMAI_APP_SECRET` | 是 | 快麦应用 App Secret |
| `KUAIMAI_SESSION` | 是 | Session 或 AccessToken |
| `KUAIMAI_REFRESH_TOKEN` | 否 | 预留刷新令牌 |
| `KUAIMAI_GATEWAY` | 否 | 默认 `https://gw.superboss.cc/router` |
| `KUAIMAI_SIGN_METHOD` | 否 | `md5`、`hmac` 或 `hmac-sha256` |

## 测试

```bash
npm test
```

## 安全说明

- `.env`、`.state.json`、`node_modules` 均被 Git 忽略
- 适配器只通过 PackingProof 扩展 API v1 通信，不读取数据库、配置或录像目录
- “查无订单”只对应快麦明确返回空列表；超时、限流和鉴权失败不会误报
