import { getDb } from '../db/connection.js';
import { nowIso } from '../utils/time.js';

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  folder: string;
  /** password = 授权码/密码登录（QQ/163/Gmail 应用密码）；oauth2 = Outlook XOAUTH2 */
  authMode: 'password' | 'oauth2';
  password?: string;
  tenant?: string; // oauth2：consumers / organizations / common / tenant-id
  clientId?: string; // oauth2：Azure 应用（客户端）ID
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** OAuth2 令牌存储（access token 短期有效，refresh token 长期） */
export interface OAuth2TokenStore {
  user: string;
  tenant: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export const DEFAULT_LLM_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_LLM_MODEL = 'deepseek-chat';

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, value, nowIso());
}

export function deleteSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
}

function parseJson<T>(key: string): T | null {
  const raw = getSetting(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getEmailConfig(): EmailConfig | null {
  const cfg = parseJson<EmailConfig & { authMode?: EmailConfig['authMode'] }>('email.config');
  if (!cfg) return null;
  // 兼容 v1.0 旧配置（无 authMode 视为密码模式）
  return { ...cfg, authMode: cfg.authMode ?? 'password' };
}

export function setEmailConfig(config: EmailConfig): void {
  setSetting('email.config', JSON.stringify(config));
}

export function getLlmConfig(): LlmConfig | null {
  return parseJson<LlmConfig>('llm.config');
}

export function setLlmConfig(config: LlmConfig): void {
  setSetting('llm.config', JSON.stringify(config));
}

export function getOauth2Token(): OAuth2TokenStore | null {
  return parseJson<OAuth2TokenStore>('oauth2.token');
}

export function setOauth2Token(token: OAuth2TokenStore): void {
  setSetting('oauth2.token', JSON.stringify(token));
}

export function clearOauth2Token(): void {
  deleteSetting('oauth2.token');
}

/** API 输出（脱敏，ADR-8） */
export function settingsPayload(): {
  email: (Omit<EmailConfig, 'password'> & { passwordSet: boolean }) | null;
  llm: (Omit<LlmConfig, 'apiKey'> & { apiKeySet: boolean }) | null;
  oauth2: { configured: boolean; user: string | null };
} {
  const email = getEmailConfig();
  const llm = getLlmConfig();
  const oauth2 = getOauth2Token();
  return {
    email: email
      ? {
          host: email.host,
          port: email.port,
          secure: email.secure,
          user: email.user,
          folder: email.folder,
          authMode: email.authMode,
          tenant: email.tenant,
          clientId: email.clientId,
          passwordSet: Boolean(email.password),
        }
      : null,
    llm: llm ? { baseUrl: llm.baseUrl, model: llm.model, apiKeySet: Boolean(llm.apiKey) } : null,
    oauth2: { configured: Boolean(oauth2), user: oauth2?.user ?? null },
  };
}
