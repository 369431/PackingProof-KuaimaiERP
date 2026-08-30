// 调试脚本：查询真实快麦订单并打印原始结构（脱敏）与映射结果
// 用法：node debug-kuaimai.js <快递单号>
import { loadEnvironment, getConfig } from './payload/src/config.js';
import { KuaimaiClient } from './payload/src/providers/kuaimai.js';
import { mapTradeList } from './payload/src/providers/kuaimai.js';

await loadEnvironment();
const config = getConfig();
const trackingNumber = process.argv[2] || '770342398050738';
const client = new KuaimaiClient(config.kuaimai);

function mask(value, max = 24) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return text.slice(0, max) + '…(' + text.length + '字符)';
}

try {
  const payload = await client.call('erp.trade.list.query', {
    outSids: trackingNumber,
    pageNo: '1',
    pageSize: '20'
  });
  console.log('=== 响应顶层字段 ===');
  console.log(Object.keys(payload));
  const trade = Array.isArray(payload?.list) ? payload.list[0] : null;
  if (!trade) {
    console.log('list 为空或结构不同:', mask(JSON.stringify(payload)));
    process.exit(0);
  }
  console.log('=== trade 字段 ===');
  for (const [key, value] of Object.entries(trade)) {
    if (Array.isArray(value)) console.log(`${key}: 数组(${value.length}项)`);
    else if (value && typeof value === 'object') console.log(`${key}: 对象 ${mask(JSON.stringify(value))}`);
    else console.log(`${key}: ${mask(value)}`);
  }
  const items = Array.isArray(trade.orders) ? trade.orders : (Array.isArray(trade.items) ? trade.items : []);
  console.log(`=== 订单商品条目 (${items.length} 项, 字段名取自第1项) ===`);
  if (items[0]) {
    console.log('字段名:', Object.keys(items[0]).join(', '));
    for (const [key, value] of Object.entries(items[0])) {
      if (Array.isArray(value)) console.log(`  ${key}: 数组(${value.length})`);
      else if (value && typeof value === 'object') console.log(`  ${key}: 对象 ${mask(JSON.stringify(value))}`);
      else console.log(`  ${key}: ${mask(value)}`);
    }
  }
  console.log('=== 当前映射结果 ===');
  console.log(JSON.stringify(mapTradeList(payload, trackingNumber), null, 2));
} catch (error) {
  console.error('查询失败:', error.message, error.details || '');
  process.exit(1);
}
