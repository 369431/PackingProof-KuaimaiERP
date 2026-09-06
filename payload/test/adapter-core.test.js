import assert from 'node:assert/strict';
import test from 'node:test';
import { createResult, runScanTaskAdapter } from '../src/adapter-core.js';
import { createProviderError } from '../src/providers/order-provider.js';

const provider = {
  name: 'fake-erp',
  providerId: '369431.fake-erp',
  capabilities: ['order.lookup', 'refund.lookup'],
  async lookup() {
    return {
      trackingNumber: 'YT1',
      orderId: 'T1',
      buyerMessage: '',
      sellerMemo: '',
      totalItemCount: 3,
      products: [{ name: '7107-黑色M', sku: '7107-黑色M', merchantSku: '7107-黑色M', quantity: 3 }],
      refundState: 'none',
      refundReason: ''
    };
  }
};

const delivery = {
  deliveryId: 'delivery-1',
  taskId: 'task-1',
  originNodeId: 'recording-node-001',
  recordingSessionId: 'recording-session-001',
  trackingNumber: 'YT1',
  recordingMode: 'shipping',
  capability: 'order.lookup'
};

test('createResult 找到订单时提交 found 与订单', async () => {
  const result = await createResult(delivery, provider);
  assert.equal(result.status, 'found');
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].totalItemCount, 3);
  assert.equal(result.providerId, '369431.fake-erp');
  assert.ok(result.resultId.startsWith('result-'));
  assert.equal(result.revision, 1);
});

test('createResult 明确查无订单时通过合成订单携带播报文案', async () => {
  const notFound = { ...provider, lookup: async () => null };
  const result = await createResult(delivery, notFound);
  assert.equal(result.status, 'found');
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].totalItemCount, 0);
  assert.equal(result.orders[0].sellerMemo, '此单号不在系统中，请核实再发');
  assert.equal(result.orders[0].refundState, 'none');
});

test('createResult 退款投递查无订单时保持 not_found 不重复播报', async () => {
  const notFound = { ...provider, lookup: async () => null };
  const refundDelivery = { ...delivery, capability: 'refund.lookup' };
  const result = await createResult(refundDelivery, notFound);
  assert.equal(result.status, 'not_found');
  assert.deepEqual(result.orders, []);
});

test('createResult 把提供方错误映射为稳定状态', async () => {
  const cases = [
    ['timeout', createProviderError('超时', 'timeout')],
    ['rate_limited', createProviderError('限流', 'rate_limited')],
    ['provider_auth_required', createProviderError('session 过期', 'provider_auth_required')],
    ['unavailable', createProviderError('网络错误')]
  ];
  for (const [expected, error] of cases) {
    const failing = { ...provider, lookup: async () => { throw error; } };
    const result = await createResult(delivery, failing);
    assert.equal(result.status, expected);
  }
});

test('createResult 未知错误回退为 unavailable', async () => {
  const failing = { ...provider, lookup: async () => { throw new Error('意外错误'); } };
  const result = await createResult(delivery, failing);
  assert.equal(result.status, 'unavailable');
});

test('runScanTaskAdapter 完成 授权-领取-确认-提交 闭环', async () => {
  const calls = [];
  const client = {
    credentialState: null,
    async enroll() {
      calls.push('enroll');
      this.credentialState = { extensionInstanceId: 'kuaimai-test', credential: 'a'.repeat(64), credentialGeneration: 1 };
      return { credentialState: this.credentialState, approval: {} };
    },
    async heartbeat() { calls.push('heartbeat'); return { ok: true }; },
    async nextTask() {
      calls.push('nextTask');
      if (calls.filter(call => call === 'nextTask').length === 2) {
        return { status: 200, ok: true, json: async () => delivery };
      }
      return { status: 204, ok: true };
    },
    async acknowledge() { calls.push('ack'); return { ok: true }; },
    async submitResult(result) { calls.push(`submit:${result.status}`); return { ok: true }; }
  };
  const saved = [];
  const results = [];

  await runScanTaskAdapter({
    client,
    provider,
    identity: { extensionInstanceId: 'kuaimai-test', providerId: provider.providerId, version: '1.0.0' },
    state: {},
    saveState: async state => saved.push(state),
    onResult: async result => results.push(result),
    maxIterations: 3,
    pollWaitSeconds: 0
  });

  assert.deepEqual(saved, [{
    extensionInstanceId: 'kuaimai-test',
    credentialState: client.credentialState
  }]);
  assert.deepEqual(calls.filter(call => call.startsWith('submit')), ['submit:found']);
  assert.equal(results.length, 1);
  assert.equal(results[0].deliveryId, 'delivery-1');
});

test('runScanTaskAdapter 无任务时循环继续且不提交', async () => {
  const client = {
    credentialState: { extensionInstanceId: 'kuaimai-test', credential: 'a'.repeat(64), credentialGeneration: 1 },
    async heartbeat() { return { ok: true }; },
    async nextTask() { return { status: 204, ok: true }; },
    async acknowledge() { return { ok: true }; },
    async submitResult() { return { ok: true }; }
  };
  let iterations = 0;
  await runScanTaskAdapter({
    client,
    provider,
    identity: { extensionInstanceId: 'kuaimai-test', providerId: provider.providerId, version: '1.0.0' },
    state: { credentialState: client.credentialState },
    saveState: async () => {},
    maxIterations: 2,
    pollWaitSeconds: 0,
    onResult: async () => { iterations += 1; }
  });
  assert.equal(iterations, 0);
});
