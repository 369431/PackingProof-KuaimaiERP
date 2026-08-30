// OrderLookupProvider 契约（面向 PackingProof 扩展 API v1）
//
// 新增 ERP 提供方时，在 providers/ 目录新建文件并实现以下接口，
// 然后在 index.js 的 provider 注册表中登记即可，无需修改适配器核心：
//
//   {
//     name: 'my-erp',                        // 提供方标识，用于日志
//     providerId: '369431.my-erp',           // 提交结果时使用的第三方来源标识
//     capabilities: ['order.lookup', 'refund.lookup'], // 声明的扩展能力
//     async lookup(trackingNumber, { signal }) {
//       // 返回订单对象（字段与扩展 API scan-results 的 orders[0] 一致）：
//       //   { trackingNumber, orderId, buyerMessage, sellerMemo,
//       //     totalItemCount, products: [{ name, sku, merchantSku, quantity }],
//       //     refundState, refundReason }
//       // 返回 null 表示提供方明确查无订单（才会触发“此单号不在系统中”）。
//       // 网络错误、超时、限流、鉴权失败必须抛错，并带 kind 属性：
//       //   'timeout' | 'rate_limited' | 'provider_auth_required'
//       //   | 'invalid_request' | 'unavailable'
//       // 禁止把非“明确查无”的情况当作 not_found 提交。
//     }
//   }
//
// 提供方错误可以直接抛带 kind 的 Error，或复用 providers/errors.js 的 ProviderError。

export function defineOrderProvider(provider) {
  if (!provider || typeof provider.lookup !== 'function') {
    throw new Error('OrderLookupProvider 必须提供 lookup(trackingNumber, { signal }) 方法');
  }
  return provider;
}

export function createProviderError(message, kind = 'unavailable', details = {}) {
  const error = new Error(message);
  error.kind = kind;
  error.details = details;
  return error;
}
