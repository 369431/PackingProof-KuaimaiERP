import { randomBytes } from 'node:crypto';
import { PackingProofExtensionClient } from './packingproof-client.js';
import { getConfig, loadEnvironment } from './config.js';
import { KuaimaiClient, KuaimaiError } from './kuaimai.js';
import { loadState, saveState } from './state.js';

await loadEnvironment();
const config = getConfig();
const state = await loadState();
const identity = {
  extensionInstanceId: state.extensionInstanceId || `kuaimai-${randomBytes(16).toString('hex')}`,
  providerId: 'packingproof.kuaimai',
  displayName: 'PackingProof 快麦 ERP 适配器',
  version: '1.0.0',
  source: 'https://github.com/369431/PackingProof-KuaimaiERP',
  requestedPermissions: ['scan-tasks.read', 'scan-results.write'],
  requestedCapabilities: ['order.lookup', 'refund.lookup']
};
const packingProof = new PackingProofExtensionClient(config.packingProofUrl, identity, state.credentialState || null);
const kuaimai = new KuaimaiClient(config.kuaimai);

if (!packingProof.credentialState) {
  console.log('正在向 PackingProof 请求授权，请在桌面端确认');
  const enrollment = await packingProof.enroll();
  await saveState({ extensionInstanceId: identity.extensionInstanceId, credentialState: enrollment.credentialState });
  console.log('授权成功');
}

let lastSuccessfulActivityAt = null;
let dataCount = 0;
const heartbeat = setInterval(async () => {
  try {
    await packingProof.heartbeat(lastSuccessfulActivityAt, dataCount);
  } catch (error) {
    console.error(`心跳失败：${error.message}`);
  }
}, 15_000);
heartbeat.unref();

console.log('快麦适配器已启动，正在等待扫码任务');
while (true) {
  try {
    const response = await packingProof.nextTask(20);
    if (response.status === 204) continue;
    if (!response.ok) throw new Error(`领取任务 HTTP ${response.status}`);
    const delivery = await response.json();
    await requireOk(packingProof.acknowledge(delivery), '确认任务');
    const result = await createResult(delivery, kuaimai);
    await requireOk(packingProof.submitResult(result), '提交结果');
    lastSuccessfulActivityAt = new Date().toISOString();
    if (result.status === 'found') dataCount += 1;
    console.log(`${delivery.trackingNumber}：${result.status}`);
  } catch (error) {
    console.error(`处理任务失败：${error.message}`);
    await delay(1_000);
  }
}

export async function createResult(delivery, client) {
  let status = 'found';
  let orders = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const order = await client.lookup(delivery.trackingNumber, controller.signal);
      if (order) orders = [order];
      else status = 'not_found';
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    status = error instanceof KuaimaiError ? error.kind : 'unavailable';
  }

  return {
    deliveryId: delivery.deliveryId,
    taskId: delivery.taskId,
    providerId: 'packingproof.kuaimai',
    resultId: `result-${randomBytes(12).toString('hex')}`,
    revision: 1,
    status,
    observedAt: new Date().toISOString(),
    orders,
    measurements: []
  };
}

async function requireOk(responsePromise, operation) {
  const response = await responsePromise;
  if (!response.ok) throw new Error(`${operation} HTTP ${response.status}`);
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
