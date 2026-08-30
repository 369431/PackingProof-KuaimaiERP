import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { computeSignature, KuaimaiClient, KuaimaiError, mapTradeList } from '../src/providers/kuaimai.js';

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
  // 只有 isRefund 标记、无具体退款状态：unknown + 备注播报“请核实后再发”
  assert.equal(order.refundState, 'unknown');
  assert.equal(order.sellerMemo, '退款状态未知，请核实后再发');
});

test('优先使用快麦商家编码，已知退款状态改为备注播报', () => {
  const order = mapTradeList({ list: [{ tid: 'T2', isRefund: 1, orders: [
    { outerSkuId: '7255-女款', title: '很长的商品标题', num: 1, refundStatus: 'WAIT_SELLER_AGREE' }
  ] }] }, 'YT2');
  assert.equal(order.products[0].name, '7255-女款');
  // 已知状态：提交 none（不阻塞件数播报）+ 备注播报中文状态
  assert.equal(order.refundState, 'none');
  assert.equal(order.sellerMemo, '退款状态：申请中');
  assert.equal(order.refundReason, 'WAIT_SELLER_AGREE');
});

test('trade 级 status 是发货状态，不得误判为退款状态', () => {
  // 真实快麦返回 trade.status=fxg_3（发货中）+ 条目 refundStatus=WAIT_SELLER_AGREE
  const order = mapTradeList({ list: [{ tid: 'T3', isRefund: 1, status: 'fxg_3', orders: [
    { outerSkuId: '9672-灰色S', num: 1, refundStatus: 'WAIT_SELLER_AGREE' }
  ] }] }, 'YT3');
  assert.equal(order.refundState, 'none');
  assert.equal(order.sellerMemo, '退款状态：申请中');
});

test('发货状态 fxg_1 且无退款标记时返回无退款', () => {
  const order = mapTradeList({ list: [{ tid: 'T4', isRefund: 0, status: 'fxg_1', orders: [
    { outerSkuId: '7268-白色S', num: 1, refundStatus: '' }
  ] }] }, 'YT4');
  assert.equal(order.refundState, 'none');
  assert.equal(order.refundReason, '');
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
