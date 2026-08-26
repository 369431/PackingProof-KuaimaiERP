import { createHash, createHmac } from 'node:crypto';

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

export function mapTradeList(payload, trackingNumber) {
  const trade = Array.isArray(payload?.list) ? payload.list[0] : null;
  if (!trade) return null;
  const items = Array.isArray(trade.orders) ? trade.orders : [];
  const products = items.map(mapProduct).filter(Boolean);
  const rawRefundStatus = firstString(trade, ['refund_status', 'refundStatus', 'status'])
    || firstString(items.find(item => firstString(item, ['refund_status', 'refundStatus'])), ['refund_status', 'refundStatus']);
  const refundState = mapRefundState(trade, items, rawRefundStatus);

  return {
    trackingNumber,
    orderId: firstString(trade, ['tid', 'order_id', 'trade_id']) || firstString(items[0], ['tid']) || '',
    buyerMessage: firstString(trade, ['buyer_message', 'buyer_memo']) || firstString(items[0], ['buyer_message', 'buyer_memo']) || '',
    sellerMemo: firstString(trade, ['seller_memo', 'seller_remark']) || firstString(items[0], ['seller_memo', 'seller_remark']) || '',
    totalItemCount: products.reduce((sum, product) => sum + product.quantity, 0),
    products,
    refundState,
    refundReason: refundState === 'none' ? '' : rawRefundStatus || '快麦订单显示退款状态'
  };
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

function mapRefundState(trade, items, rawStatus) {
  const normalized = String(rawStatus || '').trim().toUpperCase();
  if (!truthyRefund(trade?.isRefund) && !truthyRefund(trade?.isHalt)
      && (!normalized || ['0', 'FALSE', 'NO_REFUND', 'NONE'].includes(normalized))) return 'none';
  if (['WAIT_SELLER_AGREE', 'REQUESTED'].includes(normalized)) return 'requested';
  if (['WAIT_BUYER_RETURN_GOODS', 'WAIT_SELLER_CONFIRM_GOODS', 'PROCESSING'].includes(normalized)) return 'processing';
  if (['RETURNED'].includes(normalized)) return 'returned';
  if (['CLOSED', 'REJECTED'].includes(normalized)) return 'rejected';
  if (['SUCCESS', 'REFUNDED'].includes(normalized)) return 'refunded';
  const itemHasRefund = items.some(item => {
    const status = firstString(item, ['refund_status', 'refundStatus']).toUpperCase();
    return status && !['0', 'FALSE', 'NO_REFUND', 'NONE'].includes(status);
  });
  return truthyRefund(trade?.isRefund) || truthyRefund(trade?.isHalt) || itemHasRefund ? 'refunded' : 'none';
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
