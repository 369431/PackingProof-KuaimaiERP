import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { computeSignature, KuaimaiClient, KuaimaiError, mapTradeList } from '../src/kuaimai.js';

const parameters = { method: 'erp.trade.list.query', appKey: 'key', outSids: 'YT1' };
const canonical = 'appKeykeymethoderp.trade.list.queryoutSidsYT1';

test('生成快麦支持的三种签名', () => {
  assert.equal(computeSignature(parameters, 'secret', 'md5'), createHash('md5').update(`secret${canonical}secret`).digest('hex'));
  assert.equal(computeSignature(parameters, 'secret', 'hmac'), createHmac('md5', 'secret').update(canonical).digest('hex'));
  assert.equal(computeSignature(parameters, 'secret', 'hmac-sha256'), createHmac('sha256', 'secret').update(canonical).digest('hex'));
});

test('映射商品数量、退款和过滤包装 SKU', () => {
  const order = mapTradeList({ list: [{ tid: 'T1', isRefund: 1, orders: [
    { outerSkuId: '7107-黑色M', num: 2 },
    { outerSkuId: '1166-包装袋', num: 1 }
  ] }] }, 'YT1');
  assert.equal(order.orderId, 'T1');
  assert.equal(order.totalItemCount, 2);
  assert.equal(order.products.length, 1);
  assert.equal(order.products[0].name, '7107-黑色M');
  assert.equal(order.refundState, 'refunded');
});

test('优先使用快麦商家编码并映射退款处理中状态', () => {
  const order = mapTradeList({ list: [{ tid: 'T2', isRefund: 1, status: 'WAIT_SELLER_AGREE', orders: [
    { outerSkuId: '7255-女款', title: '很长的商品标题', num: 1 }
  ] }] }, 'YT2');
  assert.equal(order.products[0].name, '7255-女款');
  assert.equal(order.refundState, 'requested');
  assert.equal(order.refundReason, 'WAIT_SELLER_AGREE');
});

test('空列表返回未找到', () => {
  assert.equal(mapTradeList({ list: [] }, 'YT1'), null);
});

test('鉴权错误分类为需要更新快麦凭据', async () => {
  const client = new KuaimaiClient({ appKey: 'key', appSecret: 'secret', session: 'expired', gateway: 'https://example.test', signMethod: 'md5' }, async () => new Response(JSON.stringify({ success: false, msg: 'session 已过期' })));
  await assert.rejects(() => client.lookup('YT1'), error => error instanceof KuaimaiError && error.kind === 'provider_auth_required');
});

test('拒绝超长快递单号', async () => {
  const client = new KuaimaiClient({});
  await assert.rejects(() => client.lookup('X'.repeat(101)), error => error.kind === 'invalid_request');
});
