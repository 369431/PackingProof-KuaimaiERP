import { createHash, createHmac } from 'node:crypto';
import { defineOrderProvider } from './order-provider.js';

export class KuaimaiError extends Error {
  constructor(message, kind = 'unavailable', details = {}) {
    super(message);
    this.name = 'KuaimaiError';
    this.kind = kind;
    this.details = details;
  }
}

export class KuaimaiClient {
  constructor(options, fetchImpl = fetch) {
    this.options = { ...options };
    this.fetch = fetchImpl;
  }

  createParameters(method, businessParameters, now = new Date()) {
    const parameters = {
      method,
      appKey: this.options.appKey,
      session: this.options.session,
      timestamp: formatTimestamp(now),
      format: 'json',
      version: '1.0',
      sign_method: this.options.signMethod || 'md5',
      ...businessParameters
    };
    parameters.sign = computeSignature(parameters, this.options.appSecret, parameters.sign_method);
    return parameters;
  }

  async lookup(trackingNumber, signal) {
    const normalized = String(trackingNumber || '').trim();
    if (!normalized || normalized.length > 100) {
      throw new KuaimaiError('快递单号无效', 'invalid_request');
    }

    const payload = await this.call('erp.trade.list.query', {
      outSids: normalized,
      pageNo: '1',
      pageSize: '20'
    }, signal);
    return mapTradeList(payload, normalized);
  }

  async call(method, businessParameters, signal) {
    const parameters = this.createParameters(method, businessParameters);
    let response;
    try {
      response = await this.fetch(this.options.gateway, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(parameters),
        signal
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new KuaimaiError('快麦请求超时', 'timeout');
      throw new KuaimaiError(`无法连接快麦：${error.message}`);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new KuaimaiError(`快麦 HTTP ${response.status}`, response.status === 429 ? 'rate_limited' : 'unavailable');
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new KuaimaiError('快麦返回了无效 JSON');
    }
    assertApiSuccess(payload, method);
    return payload;
  }
}

export function computeSignature(parameters, secret, signMethod = 'md5') {
  const canonical = Object.entries(parameters)
    .filter(([key, value]) => key !== 'sign' && key && value !== null && value !== undefined && String(value) !== '')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}${value}`)
    .join('');

  if (signMethod === 'hmac') return createHmac('md5', secret).update(canonical, 'utf8').digest('hex');
  if (signMethod === 'hmac-sha256') return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  return createHash('md5').update(`${secret}${canonical}${secret}`, 'utf8').digest('hex');
}

// 将快麦客户端包装为 OrderLookupProvider，供适配器核心使用。
export function createKuaimaiProvider(options, providerId = '369431.kuaimai-erp') {
  const client = new KuaimaiClient(options);
  return defineOrderProvider({
    name: 'kuaimai',
    providerId,
    capabilities: ['order.lookup', 'refund.lookup'],
    notFoundMessage: '单号不在系统中，请核实后再发',
    async lookup(trackingNumber, { signal } = {}) {
      return client.lookup(trackingNumber, signal);
    }
  });
}

export function mapTradeList(payload, trackingNumber) {
  const trade = Array.isArray(payload?.list) ? payload.list[0] : null;
  if (!trade) return null;
  const items = Array.isArray(trade.orders) ? trade.orders : [];
  const products = items.map(mapProduct).filter(Boolean);
  // 注意：trade 级不能把 status 当退款状态（真实接口里 status 是发货状态，如 fxg_3）
  const rawRefundStatus = firstString(trade, ['refund_status', 'refundStatus'])
    || firstString(items.find(item => firstString(item, ['refund_status', 'refundStatus'])), ['refund_status', 'refundStatus']);
  const refundState = mapRefundState(trade, items, rawRefundStatus);
  // 退款信息改走卖家备注播报通道：桌面端对非 none/unknown 的退款状态会跳过
  // “订单 N 件”播报，因此这里统一提交 none/unknown，并用备注携带退款提示，
  // 保证件数一定播报、退款状态也一定播报
  let sellerMemo = firstString(trade, ['seller_memo', 'seller_remark'])
    || firstString(items[0], ['seller_memo', 'seller_remark']) || '';
  let submittedRefundState = refundState;
  if (refundState === 'unknown') {
    submittedRefundState = 'unknown';
    sellerMemo = appendMemo(sellerMemo, '退款状态未知，请核实后再发');
  } else if (refundState !== 'none') {
    submittedRefundState = 'none';
    sellerMemo = appendMemo(sellerMemo, `退款状态：${RefundStateDisplay[refundState] || refundState}`);
  }

  return {
    trackingNumber,
    orderId: firstString(trade, ['tid', 'order_id', 'trade_id']) || firstString(items[0], ['tid']) || '',
    buyerMessage: firstString(trade, ['buyer_message', 'buyer_memo']) || firstString(items[0], ['buyer_message', 'buyer_memo']) || '',
    sellerMemo,
    totalItemCount: products.reduce((sum, product) => sum + product.quantity, 0),
    products,
    refundState: submittedRefundState,
    refundReason: submittedRefundState === 'none' && refundState === 'none' ? '' : rawRefundStatus || '快麦订单显示退款状态'
  };
}

const RefundStateDisplay = {
  requested: '申请中',
  processing: '处理中',
  refunded: '已退款',
  returned: '已退货',
  rejected: '已拒绝'
};

function appendMemo(existing, warning) {
  if (!existing) return warning;
  return `${existing}；${warning}`;
}

function mapProduct(item) {
  const sku = firstString(item, ['outerSkuId', 'sysOuterId', 'outer_sku_id', 'sku']) || '';
  const name = sku || firstString(item, ['title', 'product_name', 'item_title', 'name']);
  if (!name || sku.split(/[-\s（()）]/)[0] === '1166') return null;
  const quantityValue = Number(item?.num ?? item?.quantity ?? 1);
  return {
    name,
    sku,
    merchantSku: sku,
    quantity: Number.isSafeInteger(quantityValue) && quantityValue > 0 ? quantityValue : 1
  };
}

const RefundStatusValues = new Set([
  'WAIT_SELLER_AGREE', 'REQUESTED',
  'WAIT_BUYER_RETURN_GOODS', 'WAIT_SELLER_CONFIRM_GOODS', 'PROCESSING',
  'RETURNED',
  'CLOSED', 'REJECTED',
  'SUCCESS', 'REFUNDED'
]);
const NoRefundValues = new Set(['0', 'FALSE', 'NO_REFUND', 'NONE']);

function mapRefundState(trade, items, rawStatus) {
  const normalized = String(rawStatus || '').trim().toUpperCase();
  // 商品条目级 refundStatus 是权威的退款状态；trade 级 status 是发货状态，不能参与判定
  const itemStatus = items
    .map(item => String(firstString(item, ['refund_status', 'refundStatus']) || '').trim().toUpperCase())
    .find(status => status && !NoRefundValues.has(status));
  const effective = itemStatus || (RefundStatusValues.has(normalized) ? normalized : '');
  const hasRefundSignal = truthyRefund(trade?.isRefund)
    || truthyRefund(trade?.isHalt)
    || effective.length > 0;

  if (!hasRefundSignal) return 'none';
  if (['WAIT_SELLER_AGREE', 'REQUESTED'].includes(effective)) return 'requested';
  if (['WAIT_BUYER_RETURN_GOODS', 'WAIT_SELLER_CONFIRM_GOODS', 'PROCESSING'].includes(effective)) return 'processing';
  if (['RETURNED'].includes(effective)) return 'returned';
  if (['CLOSED', 'REJECTED'].includes(effective)) return 'rejected';
  if (['SUCCESS', 'REFUNDED'].includes(effective)) return 'refunded';
  // 有退款标记但状态未知：统一按 unknown 提交（合并时不会阻塞件数播报），
  // 由 mapTradeList 通过卖家备注携带“退款状态未知，请核实后再发”提示
  return 'unknown';
}

function truthyRefund(value) {
  return value === true || value === 1 || (typeof value === 'string' && !['', '0', 'false'].includes(value.toLowerCase()));
}

function firstString(value, keys) {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'number') return String(candidate);
  }
  return '';
}

function assertApiSuccess(payload, method) {
  const responseNode = payload?.[`${method.replaceAll('.', '_')}_response`] || payload;
  const code = responseNode?.code;
  const failed = payload?.success === false || (code !== undefined && String(code) !== '0');
  if (!failed) return;
  const message = responseNode?.msg || payload?.msg || '快麦 API 请求失败';
  const authPattern = /token|session|授权|登录|过期|app.?key/i;
  throw new KuaimaiError(message, authPattern.test(message) ? 'provider_auth_required' : 'unavailable', { code });
}

function formatTimestamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
