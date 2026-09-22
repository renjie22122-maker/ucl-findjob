import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../../db/connection.js';
import { decodeJwtEmail } from './outlook.js';
import { buildAuthConfig } from '../email/imap.client.js';
import {
  getOauth2Token,
  setEmailConfig,
  setOauth2Token,
  type EmailConfig,
  type OAuth2TokenStore,
} from '../settings.service.js';

function fakeJwt(payload: unknown): string {
  const enc = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${enc}.sig`;
}

describe('Outlook OAuth2', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    getDb().exec('DELETE FROM settings;');
  });

  it('解码 id_token 中的邮箱', () => {
    expect(decodeJwtEmail(fakeJwt({ email: 'me@outlook.com' }))).toBe('me@outlook.com');
    expect(decodeJwtEmail(fakeJwt({ preferred_username: 'x@hotmail.com' }))).toBe('x@hotmail.com');
    expect(decodeJwtEmail(undefined)).toBeNull();
    expect(decodeJwtEmail('not-a-jwt')).toBeNull();
  });

  it('oauth2 模式构建 XOAUTH2 认证配置', () => {
    const cfg: EmailConfig = {
      host: 'outlook.office365.com',
      port: 993,
      secure: true,
      user: 'me@outlook.com',
      folder: 'INBOX',
      authMode: 'oauth2',
    };
    const config = buildAuthConfig(cfg, 'token-abc');
    expect(config.auth).toEqual({ user: 'me@outlook.com', accessToken: 'token-abc' });
    // 缺 token 时报错
    expect(() => buildAuthConfig(cfg, undefined)).toThrow(/重新连接/);
  });

  it('password 模式保持密码认证；旧配置缺 authMode 按密码处理', () => {
    const cfg: EmailConfig = {
      host: 'imap.qq.com',
      port: 993,
      secure: true,
      user: 'me@qq.com',
      folder: 'INBOX',
      authMode: 'password',
      password: 'authcode',
    };
    expect(buildAuthConfig(cfg)).toMatchObject({ auth: { user: 'me@qq.com', pass: 'authcode' } });

    const legacy = { ...cfg, authMode: undefined as unknown as EmailConfig['authMode'] };
    expect(buildAuthConfig(legacy)).toMatchObject({ auth: { user: 'me@qq.com', pass: 'authcode' } });
  });

  it('Token 存储读写', () => {
    const token: OAuth2TokenStore = {
      user: 'me@outlook.com',
      tenant: 'consumers',
      clientId: 'client-123',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3600_000,
    };
    setOauth2Token(token);
    expect(getOauth2Token()?.user).toBe('me@outlook.com');

    setEmailConfig({
      host: 'outlook.office365.com',
      port: 993,
      secure: true,
      user: 'me@outlook.com',
      folder: 'INBOX',
      authMode: 'oauth2',
    });
    expect(getOauth2Token()?.refreshToken).toBe('rt');
  });
});
