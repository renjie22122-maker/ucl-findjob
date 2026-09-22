import { ImapFlow } from 'imapflow';
import { EMAIL_SNIPPET_LENGTH } from '../../config.js';
import { AppError } from '../../middleware/error.js';
import type { EmailConfig } from '../settings.service.js';
import { ensureFreshAccessToken } from '../oauth2/outlook.js';
import { auditTimer } from '../audit.service.js';

export interface RawEmail {
  messageId: string;
  subject: string;
  sender: string;
  receivedAt: string;
  snippet: string;
}

interface AuthConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass?: string; accessToken?: string };
  logger: false;
}

/** 构建 imapflow 连接配置（纯函数，便于单测）：oauth2 模式用 XOAUTH2 access token */
export function buildAuthConfig(cfg: EmailConfig, oauth2AccessToken?: string): AuthConfig {
  if (cfg.authMode === 'oauth2') {
    if (!oauth2AccessToken) throw AppError.validation('Outlook 授权已失效，请在设置页重新连接');
    return {
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, accessToken: oauth2AccessToken },
      logger: false,
    };
  }
  if (!cfg.password) throw AppError.validation('请先在设置页配置邮箱授权码');
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
  };
}

async function resolveAuth(cfg: EmailConfig): Promise<AuthConfig> {
  if (cfg.authMode === 'oauth2') {
    const token = await ensureFreshAccessToken(); // 过期自动刷新
    return buildAuthConfig(cfg, token?.accessToken);
  }
  return buildAuthConfig(cfg);
}

/** 拉取最近 N 天邮件（含正文摘要，截断保体积），记录出站审计 */
export async function fetchRecentEmails(cfg: EmailConfig, days: number): Promise<RawEmail[]> {
  const timer = auditTimer({
    kind: 'imap',
    target: `${cfg.host}:${cfg.port}（${cfg.folder || 'INBOX'}）`,
    detail: `账号=${cfg.user}；拉取最近 ${days} 天邮件`,
  });
  try {
    const client = new ImapFlow(await resolveAuth(cfg));
    await client.connect();

    try {
      const lock = await client.getMailboxLock(cfg.folder || 'INBOX');
      try {
        const since = new Date(Date.now() - days * 86400_000);
        const out: RawEmail[] = [];

        for await (const msg of client.fetch(
          { since },
          { envelope: true, bodyStructure: true, uid: false },
        )) {
          if (!msg.envelope) continue;
          let snippet = '';
          // 取第一个 text/plain 部分
          try {
            const textPart = (msg.bodyStructure?.childNodes ?? []).find(
              (p) => p.type === 'text/plain' && !p.disposition,
            );
            const part = textPart ? `${textPart.part}` : 'text';
            const body = await client.download(msg.seq, part, { maxBytes: EMAIL_SNIPPET_LENGTH * 4 });
            snippet = String(body)
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, EMAIL_SNIPPET_LENGTH);
          } catch {
            snippet = '';
          }

          out.push({
            messageId: msg.envelope.messageId ?? `fallback:${msg.seq}:${msg.envelope.date?.toISOString()}`,
            subject: msg.envelope.subject ?? '(无主题)',
            sender:
              (msg.envelope.from?.length
                ? `${msg.envelope.from[0].name ?? ''} <${msg.envelope.from[0].address ?? ''}>`
                : '(未知发件人)'),
            receivedAt: (msg.envelope.date ?? new Date()).toISOString(),
            snippet,
          });
        }
        timer.ok(`拉取 ${out.length} 封`);
        return out;
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    timer.fail(message);
    throw err;
  }
}

/** 测试 IMAP 连接（设置页「测试连接」，两种认证模式通用），记录出站审计 */
export async function testEmailConnection(cfg: EmailConfig): Promise<{ ok: boolean; message: string }> {
  const timer = auditTimer({
    kind: 'imap',
    target: `${cfg.host}:${cfg.port}（${cfg.folder || 'INBOX'}）`,
    detail: `账号=${cfg.user}；测试连接`,
  });
  try {
    const client = new ImapFlow(await resolveAuth(cfg));
    try {
      await client.connect();
      const status = await client.status(cfg.folder || 'INBOX', { messages: true });
      timer.ok(`连接成功，收件箱 ${status.messages} 封`);
      return { ok: true, message: `连接成功，收件箱共 ${status.messages} 封邮件` };
    } finally {
      await client.logout().catch(() => undefined);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    timer.fail(msg);
    return { ok: false, message: `连接失败：${msg}` };
  }
}
