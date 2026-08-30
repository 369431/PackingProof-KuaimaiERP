import { randomBytes } from 'node:crypto';
import { PackingProofExtensionClient } from './packingproof-client.js';
import { getConfig, loadEnvironment } from './config.js';
import { loadState, saveState } from './state.js';
import { runScanTaskAdapter } from './adapter-core.js';
import { createKuaimaiProvider } from './providers/kuaimai.js';

await loadEnvironment();
const config = getConfig();

// ERP 提供方注册表：新增平台时在此登记，并通过 ERP_PROVIDER 环境变量选择。
const providers = {
  kuaimai: createKuaimaiProvider(config.kuaimai)
};
const provider = providers[config.provider] || providers.kuaimai;

const state = await loadState();
// 权限版本 2：新增 orders.write（原生订单推送/播放渠道）。旧凭据缺少该权限时重新授权
const needsReenroll = state.permissionVersion !== 2;
const identity = {
  // 允许通过环境变量固定实例 ID（测试和工位绑定场景），否则沿用已持久化的实例 ID
  extensionInstanceId: config.extensionInstanceId
    || state.extensionInstanceId
    || `kuaimai-${randomBytes(16).toString('hex')}`,
  providerId: provider.providerId,
  displayName: 'PackingProof 快麦 ERP 适配器',
  version: '1.0.0',
  source: 'https://github.com/369431/PackingProof-KuaimaiERP',
  requestedPermissions: ['scan-tasks.read', 'scan-results.write', 'orders.write'],
  requestedCapabilities: provider.capabilities
};
const packingProof = new PackingProofExtensionClient(
  config.packingProofUrl,
  identity,
  needsReenroll ? null : (state.credentialState || null));

console.log(`快麦适配器已启动（provider=${provider.name}，orders.write=${needsReenroll ? '待授权' : '已授权'}），正在等待扫码任务`);
await runScanTaskAdapter({
  client: packingProof,
  provider,
  identity,
  state,
  saveState: async nextState => saveState({ ...nextState, permissionVersion: 2 })
});
