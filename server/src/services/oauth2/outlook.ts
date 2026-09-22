import { AppError } from '../../middleware/error.js';
import {
  clearOauth2Token,
  getOauth2Token,
  setEmailConfig,
  setOauth2Token,
} from '../settings.service.js';
import type { OAuth2TokenStore } from '../settings.service.js';
import { auditTimer, recordAudit } from '../audit.service.js';

/**
 * Outlook（Microsoft 身份平台）OAuth2 设备码流程。
 * 微软已停用 Outlook.com/Exchange Online 的基本认证（2024-09），
 * IMAP 需通过 XOAUTH2 access token 访问（imapflow 原生支持）。
 */

const SCOPE = 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All openid profile';

export const OUTLOOK_IMAP_HOST = 'outlook.office365.com';
export const OUTLOOK_IMAP_PORT = 993;

function authority(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}

export interface DeviceCodeStart {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** 第一步：申请设备码 */
export async function startDeviceCode(tenant: string, clientId: string): Promise<DeviceCodeStart> {
  const timer = auditTimer({
    kind: 'oauth2',
    target: `${authority(tenant)}/devicecode`,
    detail: `申请设备码（账户类型 ${tenant}，Client ID ${clientId.slice(0, 8)}…）`,
  });
  try {
    const res = await fetch(`${authority(tenant)}/devicecode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scope: SCOPE }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as {
      user_code?: string;
      device_code?: string;
      verification_uri?: string;
      expires_in?: number;
      interval?: number;
      error_description?: string;
      error?: string;
    } | null;
    if (!res.ok || !data?.user_code || !data?.device_code) {
      const message = `设备码申请失败：${data?.error_description ?? data?.error ?? `HTTP ${res.status}`}（请检查 Client ID 与账户类型是否匹配）`;
      timer.fail(message);
      throw AppError.badGateway(message);
    }
    timer.ok('设备码已生成');
    return {
      userCode: data.user_code,
      deviceCode: data.device_code,
      verificationUri: data.verification_uri ?? 'https://microsoft.com/devicelogin',
      expiresIn: data.expires_in ?? 900,
      interval: Math.max(3, data.interval ?? 5),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    timer.fail(message);
    throw AppError.badGateway(`设备码申请失败：${message}`);
  }
}

export type PollStatus = 'pending' | 'slow_down' | 'complete' | 'expired' | 'error';

export interface PollResult {
  status: PollStatus;
  email?: string;
  message?: string;
}

/** 解析 id_token 中的邮箱（JWT payload，无第三方依赖） */
export function decodeJwtEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: string;
      preferred_username?: string;
      upn?: string;
    };
    return json.email ?? json.preferred_username ?? json.upn ?? null;
  } catch {
    return null;
  }
}

/** 第二步：轮询换取令牌；成功后自动落库（email.config + token） */
export async function pollDeviceCode(tenant: string, clientId: string, deviceCode: string): Promise<PollResult> {
  const res = await fetch(`${authority(tenant)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: deviceCode,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;

  if (res.ok && data?.access_token) {
    const email = decodeJwtEmail(data.id_token) ?? 'outlook-user';
    const token: OAuth2TokenStore = {
      user: email,
      tenant,
      clientId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    setOauth2Token(token);
    setEmailConfig({
      host: OUTLOOK_IMAP_HOST,
      port: OUTLOOK_IMAP_PORT,
      secure: true,
      user: email,
      folder: 'INBOX',
      authMode: 'oauth2',
      tenant,
      clientId,
    });
    recordAudit({
      kind: 'oauth2',
      target: `${authority(tenant)}/token`,
      detail: `设备码换令牌成功（账户 ${email}）`,
      status: 'success',
      result: '授权完成，Outlook 邮箱已连接',
    });
    return { status: 'complete', email };
  }

  switch (data?.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      return { status: 'slow_down' };
    case 'expired_token':
      recordAudit({
        kind: 'oauth2',
        target: `${authority(tenant)}/token`,
        detail: '设备码轮询',
        status: 'failed',
        error: '验证码已过期',
      });
      return { status: 'expired', message: '验证码已过期，请重新发起连接' };
    case 'access_denied':
      recordAudit({
        kind: 'oauth2',
        target: `${authority(tenant)}/token`,
        detail: '设备码轮询',
        status: 'failed',
        error: '用户拒绝授权',
      });
      return { status: 'error', message: '授权被拒绝' };
    default:
      recordAudit({
        kind: 'oauth2',
        target: `${authority(tenant)}/token`,
        detail: '设备码轮询',
        status: 'failed',
        error: data?.error_description ?? data?.error ?? `HTTP ${res.status}`,
      });
      return { status: 'error', message: data?.error_description ?? data?.error ?? `HTTP ${res.status}` };
  }
}

/** access token 过期前自动用 refresh token 换新，记录出站审计 */
export async function ensureFreshAccessToken(): Promise<OAuth2TokenStore | null> {
  const token = getOauth2Token();
  if (!token) return null;
  if (token.expiresAt > Date.now() + 5 * 60_000) return token;

  const timer = auditTimer({
    kind: 'oauth2',
    target: `${authority(token.tenant)}/token`,
    detail: `刷新 access token（账户 ${token.user}）`,
  });
  const res = await fetch(`${authority(token.tenant)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: token.clientId,
      refresh_token: token.refreshToken,
      scope: SCOPE,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  } | null;
  if (!res.ok || !data?.access_token) {
    // 刷新失败：清理令牌，让用户在设置页重新授权
    clearOauth2Token();
    const message = 'Outlook 授权已失效，请在设置页重新连接 Outlook';
    timer.fail(message);
    throw AppError.badGateway(message);
  }
  const updated: OAuth2TokenStore = {
    ...token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? token.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  setOauth2Token(updated);
  timer.ok('Token 刷新成功');
  return updated;
}

export function disconnectOauth2(): void {
  clearOauth2Token();
}
