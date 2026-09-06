# PackingProof 快麦 ERP 适配器

把 PackingProof Desktop 的扫码任务接入快麦 ERP。仓库人员扫描快递单号后，适配器自动查询快麦订单，并把商家编码、商品件数、买卖家备注和退款状态安全回传给 PackingProof。

本仓库是遵循 [PackingProof 扩展市场协议 v1](https://github.com/PackingProof/PackingProof-Extensions/blob/main/docs/PROTOCOL_V1.md) 的扩展项目：`payload/` 是可运行的独立适配器，`manifest.json` 描述安装包，`submission.json` 记录市场投稿信息。本项目只通过 PackingProof 扩展 API v1 通信，不读取数据库、配置文件或录像目录。

## 已实现功能

- 使用 `erp.trade.list.query` 按快递单号查询快麦订单
- 商品优先显示 `outerSkuId` / `sysOuterId` 商家编码，不显示冗长商品标题
- 多个商品逐行显示，例如：

  ```text
  商品：9678-橘色M
  9678-燕麦色M
  9678-黑色M
  9678-绿色M
  ```

- 汇总并播报订单商品总件数，例如“订单 4 件”
- 退款状态映射为申请中、处理中、已退款、已退货、已拒绝
- 快麦明确查无订单时播报“此单号不在系统中，请核实再发”
- 查询结果稍晚返回或录像停止后，桌面端仍可继续接收和显示
- 使用签名扩展凭据，不向适配器暴露 PackingProof 数据库和录像路径

## 安装（PackingProof 扩展）

1. 在 GitHub Release 下载 `369431.kuaimai-erp-1.0.2.ppext`，或从 [PackingProof 扩展市场](https://github.com/PackingProof/PackingProof-Extensions) 安装
2. 在 PackingProof 的“设置 → 扩展与联动”中开启“启用扩展 API”
3. 导入并安装扩展；外部适配器需要手动启动（`payload/start.cmd`）
4. 首次运行时，在 PackingProof 弹出的授权窗口中批准适配器

## 手动运行（开发模式）

要求 Node.js 20 或更高版本，以及支持扩展 API v1 的 PackingProof Desktop。

1. 进入 `payload/` 目录
2. 复制 `.env.example` 为 `.env`，填写快麦开放平台 API 信息：

   ```env
   PACKINGPROOF_URL=http://127.0.0.1:5280
   KUAIMAI_APP_KEY=你的AppKey
   KUAIMAI_APP_SECRET=你的AppSecret
   KUAIMAI_SESSION=你的Session或AccessToken
   KUAIMAI_REFRESH_TOKEN=
   KUAIMAI_GATEWAY=https://gw.superboss.cc/router
   KUAIMAI_SIGN_METHOD=md5
   ```

3. 在 PackingProof 的“设置 → 扩展与联动”中开启“启用扩展 API”
4. 在 `payload/` 目录运行 `npm start`
5. 首次运行时，在 PackingProof 弹出的授权窗口中批准适配器

项目没有第三方 npm 依赖，填写 API 后即可运行。授权完成后保持适配器运行，PackingProof 扫码时会自动查询快麦。

## 扩展性

适配器核心（`payload/src/adapter-core.js`）与 ERP 平台解耦，通过 `ERP_PROVIDER` 环境变量选择提供方。
新增平台时在 `payload/src/providers/` 实现 [OrderLookupProvider 契约](payload/src/providers/order-provider.js) 并登记到 `payload/src/index.js` 即可，无需修改适配器核心。

## 安全说明

- `.env`、`.state.json` 和 `node_modules` 已加入 `.gitignore`
- 不要把 App Secret、Session、AccessToken、RefreshToken 或扩展凭据提交到 Git
- 适配器只申请 `scan-tasks.read` 和 `scan-results.write` 权限
- 日志不输出快麦请求正文、返回正文或任何凭据
- “查无订单”只对应快麦明确返回空列表；超时、限流和鉴权失败不会误报

## 开发文档

字段映射、状态映射、桌面端交互要求和验收用例见 [开发与适配说明](docs/开发与适配说明.md)。

运行测试：

```bash
cd payload
npm test
```

## 许可证

[GNU Affero General Public License v3.0](LICENSE)
