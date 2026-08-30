import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loadEnvironment(fileName = '.env') {
  try {
    const content = await readFile(resolve(fileName), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*[=:]\s*(.*?)\s*$/);
      if (!match || match[2] === '' || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = unquote(match[2]);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function unquote(value) {
  value = value.replace(/,\s*$/, '');
  if (value.length >= 2 && value[0] === value.at(-1) && ['"', "'"].includes(value[0])) {
    return value.slice(1, -1);
  }
  return value;
}

export function getConfig() {
  const appKey = readValue('KUAIMAI_APP_KEY', 'appKey');
  const appSecret = readValue('KUAIMAI_APP_SECRET', 'appSecret');
  const session = readValue('KUAIMAI_SESSION', 'accessToken');
  const required = { KUAIMAI_APP_KEY: appKey, KUAIMAI_APP_SECRET: appSecret, KUAIMAI_SESSION: session };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`请在 .env 中填写：${missing.join(', ')}`);

  const signMethod = (process.env.KUAIMAI_SIGN_METHOD || 'md5').toLowerCase();
  if (!['md5', 'hmac', 'hmac-sha256'].includes(signMethod)) {
    throw new Error('KUAIMAI_SIGN_METHOD 只支持 md5、hmac 或 hmac-sha256');
  }

  return {
    packingProofUrl: (process.env.PACKINGPROOF_URL || 'http://127.0.0.1:5280').replace(/\/$/, ''),
    provider: (process.env.ERP_PROVIDER || 'kuaimai').trim().toLowerCase(),
    extensionInstanceId: process.env.PACKINGPROOF_EXTENSION_INSTANCE_ID?.trim() || '',
    kuaimai: {
      appKey,
      appSecret,
      session,
      refreshToken: readValue('KUAIMAI_REFRESH_TOKEN', 'refreshToken'),
      gateway: process.env.KUAIMAI_GATEWAY?.trim() || 'https://gw.superboss.cc/router',
      signMethod,
      // 兼容上游桌面端原生退款警报：默认 true；设 0 切回增强模式（无警报，备注播报）
      refundCompat: process.env.KUAIMAI_REFUND_COMPAT !== '0'
    }
  };
}

function readValue(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}
