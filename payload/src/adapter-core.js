// 适配器核心：与 PackingProof 扩展 API v1 的扫码任务闭环解耦。
// 任何实现 OrderLookupProvider 契约（见 providers/order-provider.js）的提供方都可以插入运行。
// 本模块不包含任何 ERP 平台专用逻辑，也不直接访问 PackingProof 数据库或录像目录。

export async function runScanTaskAdapter(options) {
  const {
    client,       // PackingProofExtensionClient 实例
    provider,     // OrderLookupProvider：{ name, capabilities, lookup(trackingNumber, { signal }) }
    identity,     // 扩展身份，用于授权与心跳
    state,        // { extensionInstanceId?, credentialState? }
    saveState,    // async (state) => void，持久化授权凭据
    onResult,     // 可选：async (result, delivery) => void，结果提交成功后回调（测试钩子）
    maxIterations = Number.POSITIVE_INFINITY, // 可选：处理任务上限（测试用），默认无限
    taskTimeoutMs = 12_000,
    pollWaitSeconds = 20
  } = options;

  if (!client.credentialState) {
    console.log('正在向 PackingProof 请求授权，请在桌面端确认');
    const enrollment = await client.enroll();
    await saveState({
      extensionInstanceId: identity.extensionInstanceId,
      credentialState: enrollment.credentialState
    });
    console.log('授权成功');
  }

  let lastSuccessfulActivityAt = null;
  let dataCount = 0;
  const heartbeat = setInterval(async () => {
    try {
      await client.heartbeat(lastSuccessfulActivityAt, dataCount);
    } catch (error) {
      console.error(`心跳失败：${error.message}`);
    }
  }, 15_000);
  heartbeat.unref();

  let iterations = 0;
  while (iterations < maxIterations) {
    iterations += 1;
    try {
      const response = await client.nextTask(pollWaitSeconds);
      if (response.status === 204) continue;
      if (!response.ok) throw new Error(`领取任务 HTTP ${response.status}`);
      const delivery = await response.json();
      await requireOk(client.acknowledge(delivery), '确认任务');
      const result = await createResult(delivery, provider, taskTimeoutMs);
      await requireOk(client.submitResult(result), '提交结果');
      lastSuccessfulActivityAt = new Date().toISOString();
      if (result.status === 'found') dataCount += 1;
      console.log(`${delivery.trackingNumber}：${result.status}`);
      // 走软件原生播放渠道：把退款订单推送到软件的订单缓存，触发原生警报播报
      if (provider.pushNativeOrder && result.status === 'found' && result.orders.length > 0) {
        try {
          const pushOrders = result.orders
            .map(order => provider.pushNativeOrder(order))
            .filter(Boolean);
          if (pushOrders.length > 0) {
            await requireOk(client.pushOrders(provider.providerId, pushOrders), '推送订单到软件播放渠道');
          }
        } catch (error) {
          console.error(`推送订单到软件播放渠道失败（需要 orders.write 权限，请重新授权）：${error.message}`);
        }
      }
      if (onResult) await onResult(result, delivery);
    } catch (error) {
      console.error(`处理任务失败：${error.message}`);
      await delay(1_000);
    }
  }
}

export async function createResult(delivery, provider, taskTimeoutMs = 12_000) {
  let status = 'found';
  let orders = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), taskTimeoutMs);
    try {
      const order = await provider.lookup(delivery.trackingNumber, { signal: controller.signal });
      if (order) {
        orders = [order];
      } else if (delivery.capability === 'refund.lookup') {
        // 退款投递不重复携带“查无订单”播报，保持 not_found 语义
        status = 'not_found';
      } else {
        // 桌面端只对带订单的 found 结果播报备注，因此查无订单时提交一条
        // 零商品的合成订单，通过卖家备注触发“此单号不在系统中”播报
        status = 'found';
        orders = [{
          trackingNumber: delivery.trackingNumber,
          orderId: delivery.trackingNumber,
          buyerMessage: '',
          sellerMemo: provider.notFoundMessage || '此单号不在系统中，请核实再发',
          totalItemCount: 0,
          products: [],
          refundState: 'none',
          refundReason: ''
        }];
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    status = error?.kind || 'unavailable';
  }

  return {
    deliveryId: delivery.deliveryId,
    taskId: delivery.taskId,
    providerId: provider.providerId,
    resultId: `result-${randomId(12)}`,
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

function randomId(byteLength) {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(byteLength)))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}
