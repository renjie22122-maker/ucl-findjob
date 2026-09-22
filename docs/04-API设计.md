# 04 API 设计

> 版本：v1.0 ｜ 状态：待评审 ｜ 前缀：`/api`

## 1. 通用约定

- 协议：HTTP + JSON；时间统一 ISO 8601 本地时区字符串（`2025-09-20T14:00:00`）；
- 列表分页：`page`（从 1 开始）、`pageSize`（默认 20，上限 100），响应含 `total`；
- 错误响应统一结构：

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "字段 deadline 格式不正确" } }
```

| HTTP 状态 | 语义 |
| --- | --- |
| 200/201 | 成功 |
| 400 | 参数校验失败 / 非法状态流转（`INVALID_TRANSITION`） |
| 404 | 资源不存在 |
| 409 | 冲突（如公司重名） |
| 500 | 服务器内部错误 |

- 列表响应统一结构：`{ "items": [...], "total": 123, "page": 1, "pageSize": 20 }`。

## 2. 端点总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/health | 健康检查 |
| GET | /api/stats/overview | 看板统计 |
| GET | /api/stats/trends | 近 N 天趋势 |
| GET | /api/today | 今日提醒与待办 |
| GET | /api/companies | 公司列表（关键词） |
| POST | /api/companies | 新建公司 |
| GET | /api/companies/:id | 公司详情 |
| PUT | /api/companies/:id | 更新公司 |
| DELETE | /api/companies/:id | 删除公司（级联删除其申请） |
| GET | /api/applications | 申请列表（筛选/分页/排序） |
| POST | /api/applications | 新建申请 |
| GET | /api/applications/:id | 申请详情（含公司、时间线、提醒） |
| PUT | /api/applications/:id | 更新申请基本信息 |
| DELETE | /api/applications/:id | 删除申请 |
| POST | /api/applications/:id/transitions | 状态流转（核心接口） |
| POST | /api/applications/:id/timeline | 追加笔记事件 |
| GET | /api/reminders | 提醒列表（时间范围/完成状态） |
| POST | /api/reminders | 新建提醒 |
| PUT | /api/reminders/:id | 更新提醒 |
| PATCH | /api/reminders/:id/done | 标记完成/取消完成 |
| DELETE | /api/reminders/:id | 删除提醒 |
| POST | /api/import/excel | Excel 批量导入 |
| POST | /api/import/records | 批量导入归一化记录（爬虫预览勾选后提交） |
| GET | /api/sources | 数据源注册表（含牛客网参数说明） |
| POST | /api/crawl | 触发爬虫抓取，返回归一化记录 |
| GET | /api/settings | 读取配置（敏感字段脱敏） |
| PUT | /api/settings | 更新配置 |
| POST | /api/settings/test-email | 测试 IMAP 连接 |
| POST | /api/settings/test-llm | 测试 LLM 连通性 |
| POST | /api/email/analyze | 拉取并分析最近 N 天邮件 |
| GET | /api/email/items | 邮件分析记录列表（按状态筛选） |
| POST | /api/email/items/:id/apply | 应用提取结果（生成时间线/提醒） |
| POST | /api/email/items/:id/dismiss | 忽略该邮件 |
| POST | /api/utils/parse-jd | 解析官网 JD 链接（预填信息） |
| GET | /api/crawl-jobs | 定时抓取任务列表 |
| POST | /api/crawl-jobs | 新建定时任务 |
| PUT | /api/crawl-jobs/:id | 更新任务（含启用开关） |
| DELETE | /api/crawl-jobs/:id | 删除任务 |
| POST | /api/crawl-jobs/:id/run-now | 立即执行（异步，202） |
| GET | /api/crawl-runs | 运行历史（分页） |
| POST | /api/email/apply-batch | 批量应用高置信度邮件（≥0.8） |
| GET | /api/oauth2/status | Outlook OAuth2 连接状态 |
| POST | /api/oauth2/start | 设备码流程第一步：申请设备码 |
| POST | /api/oauth2/poll | 设备码流程第二步：轮询换令牌 |
| POST | /api/oauth2/disconnect | 断开 Outlook 连接 |
| GET | /api/audit | 出站调用审计列表（类型过滤/分页） |
| DELETE | /api/audit | 清空审计日志 |
| GET | /api/export/excel | Excel 导出（按筛选条件） |
| GET | /api/export/template | 下载导入模板 |

## 3. 核心接口明细

### 3.1 状态流转（POST /api/applications/:id/transitions）

请求：

```json
{ "toStatus": "INTERVIEW_1", "note": "收到面试通知", "occurredAt": "2025-09-20T10:00:00" }
```

- `occurredAt` 可选，默认当前时间；
- 服务端按状态机规则校验（文档 01 §4.1）；非法流转返回 400 `INVALID_TRANSITION`。

响应（201）：

```json
{
  "application": { "id": 12, "status": "INTERVIEW_1", "updatedAt": "2025-09-20T10:00:00", "...": "..." },
  "event": { "id": 88, "eventType": "status_change", "fromStatus": "APPLIED", "toStatus": "INTERVIEW_1", "title": "状态更新：已投递 → 一面" }
}
```

### 3.2 看板统计（GET /api/stats/overview）

```json
{
  "total": 86,              // 申请总数
  "active": 32,             // 非终态数量
  "byStatus": { "WISHLIST": 8, "APPLIED": 20, "INTERVIEW_1": 4, "...": "..." },
  "offers": 2,              // OFFER + SIGNED
  "signed": 1,
  "rejected": 24,
  "funnel": { "applied": 78, "interviewed": 15, "offer": 2 },
  "todayCount": 3,          // 今日未完成提醒数
  "recentApplied7d": 9      // 近 7 天新投递
}
```

统计口径：

- `funnel.applied`：状态曾到达 APPLIED 及之后的申请数；
- `funnel.interviewed`：状态曾到达 INTERVIEW_1 及之后的申请数；
- `funnel.offer`：曾到达 OFFER 及之后的申请数；
- 均按时间线事件推导（事件溯源），保证口径一致。

### 3.3 趋势（GET /api/stats/trends?days=30）

```json
{
  "items": [
    { "date": "2025-08-22", "applied": 3, "interviewed": 1, "offer": 0, "rejected": 2 },
    { "...": "..." }
  ]
}
```

- `applied`：当天新增「进入 APPLIED」的申请数；`interviewed`：当天进入面试各轮/笔试的数量；`offer`：当天进入 OFFER/SIGNED；`rejected`：当天进入 REJECTED/WITHDRAWN。

### 3.4 今日提醒（GET /api/today）

```json
{
  "date": "2025-09-20",
  "overdue": [ { "id": 5, "title": "投递截止：美团-后端", "type": "deadline", "scheduledAt": "2025-09-19", "applicationId": 33 } ],
  "today":  [ { "id": 6, "title": "字节跳动 一面", "type": "interview", "scheduledAt": "2025-09-20T14:00:00", "applicationId": 12 } ],
  "upcoming": [ { "...": "未来 3 天" } ]
}
```

### 3.5 申请列表（GET /api/applications）

查询参数：

| 参数 | 说明 |
| --- | --- |
| status | 状态枚举，可多值（`status=APPLIED&status=INTERVIEW_1`） |
| companyId | 公司过滤 |
| jobType | school / intern |
| priority | HIGH / MEDIUM / LOW |
| keyword | 模糊匹配公司名/岗位名 |
| sortBy | updatedAt（默认）/ appliedAt / deadline |
| sortOrder | desc（默认）/ asc |
| page / pageSize | 分页 |

### 3.6 Excel 导入（POST /api/import/excel）

- `multipart/form-data`，字段 `file`；
- 按模板列解析（文档 06 §3），返回：

```json
{ "imported": 42, "skipped": 3, "errors": [ { "row": 5, "message": "缺少公司名称" } ] }
```

### 3.7 数据源与爬虫

**GET /api/sources**

```json
{
  "items": [
    {
      "id": "nowcoder",
      "name": "牛客网",
      "description": "按关键词抓取校招/实习职位列表",
      "params": [
        { "key": "keyword", "label": "关键词", "type": "text", "required": true },
        { "key": "recruitType", "label": "类型", "type": "select", "options": [{ "value": "school", "label": "校招" }, { "value": "intern", "label": "实习" }] },
        { "key": "maxPages", "label": "页数", "type": "number", "default": 3, "max": 10 }
      ]
    }
  ]
}
```

**POST /api/crawl**

请求：`{ "sourceId": "nowcoder", "params": { "keyword": "后端", "recruitType": "school", "maxPages": 3 } }`

响应（201）：

```json
{
  "sourceId": "nowcoder",
  "count": 45,
  "records": [
    {
      "sourceKey": "nowcoder:12345",
      "companyName": "字节跳动",
      "positionTitle": "后端开发工程师-2026 秋招",
      "jobType": "school",
      "channel": "牛客网",
      "jdUrl": "https://www.nowcoder.com/job/detail/12345",
      "salary": "30-50K·16薪",
      "city": "北京",
      "note": "薪资：30-50K·16薪；城市：北京"
    }
  ]
}
```

- 同步执行（限速 ≥1.5s/请求，maxPages ≤ 10），默认最多 3 页；
- 失败返回 502 并附错误信息（网络异常/页面结构变化），不影响其他功能。

**POST /api/import/records**

请求：`{ "records": [RawJobRecord, ...] }`（结构见文档 06 §2）

响应：`{ "imported": 12, "skipped": 3, "errors": [] }`（同 ImportService 口径）

### 3.8 邮件智能分析

**POST /api/email/analyze**

请求：`{ "days": 14 }`（默认 14，上限 30）

流程：IMAP 拉取该时间段邮件 → 本地关键词初筛（面试/笔试/测评/offer/录用/感谢信/内推等）→ `message_id` 去重 → LLM 提取（未配置 Key 时规则降级）→ 落库 `email_items(status=pending)`。

响应（201）：

```json
{
  "fetched": 128,      // 拉取总数
  "candidates": 9,     // 初筛候选数
  "analyzed": 7,       // 本次新分析数
  "skipped": 2         // 已存在去重数
}
```

**GET /api/email/items?status=pending&page=1&pageSize=20**

```json
{
  "items": [
    {
      "id": 3,
      "messageId": "<abc@mail.com>",
      "subject": "【字节跳动】面试邀请：后端开发工程师",
      "sender": "字节跳动校招 <campus@bytedance.com>",
      "receivedAt": "2025-09-18T10:00:00",
      "snippet": "恭喜您通过笔试，邀请您于 9月20日 14:00 参加一面……",
      "extracted": { "company": "字节跳动", "eventType": "interview", "eventTime": "2025-09-20T14:00:00", "positionTitle": "后端开发工程师", "summary": "一面面试邀请", "confidence": 0.92 },
      "status": "pending",
      "applicationId": null
    }
  ],
  "total": 3,
  "page": 1,
  "pageSize": 20
}
```

**POST /api/email/items/:id/apply**

请求（可编辑修正提取结果后再应用）：`{ "extracted": { "...": "修正后的提取结果" } }`

服务端行为（事务）：
1. 按 `extracted.company` 模糊匹配 companies（存在则复用，不存在不自动创建公司）；
2. 匹配到申请（公司 + 岗位）则关联，否则仅记笔记；
3. 生成时间线笔记事件（标题：「邮件：面试邀请」，描述含 summary）；
4. `extracted.eventTime` 为未来时间时自动创建对应类型提醒；
5. `email_items.status → confirmed`，返回生成的 `{ timelineEvent, reminder }`。

> 状态机变更不在本接口发生：邮件只提供信息，用户确认后自行走流转接口（ADR-7）。

**POST /api/email/items/:id/dismiss** → `{ "status": "dismissed" }`

### 3.9 设置与工具

**GET /api/settings**（脱敏）

```json
{ "email": { "host": "imap.qq.com", "port": 993, "secure": true, "user": "me@qq.com", "passwordSet": true, "folder": "INBOX" }, "llm": { "baseUrl": "https://api.deepseek.com", "model": "deepseek-chat", "apiKeySet": false } }
```

**PUT /api/settings**：部分更新；`email.password` / `llm.apiKey` 传明文仅在本地存储，响应仍脱敏。

**POST /api/settings/test-email** → `{ "ok": true, "message": "连接成功，找到 128 封邮件" }`（失败 400 + 原因，如授权码错误/服务器不可达）

**POST /api/settings/test-llm** → `{ "ok": true, "message": "连通正常" }`

**POST /api/utils/parse-jd**（官网投递追踪辅助）

请求：`{ "url": "https://job.toutiao.com/..." }`

响应：`{ "title": "后端开发工程师-2026 秋招", "companyHint": "字节跳动", "description": "……" }`

- 服务端 fetch 页面并提取 `<title>` / `meta[description]`，超时 8s；
- JS 渲染的官网页面可能提取不到，此时仅回显标题，表单仍可手动填写（F14 兜底）。

### 3.10 定时自动抓取（v1.1，F15）

- 任务字段：`{ sourceId, keyword, recruitType, maxPages, frequency: daily|weekly, enabled }`；
- 调度：应用运行期间每分钟检查，`isJobDue` 判定到期（daily：上次运行非今天；weekly：≥7 天；失败同样更新 last_run_at 防止重试风暴，下一周期再试）；
- 执行：抓取 → `importRecords`（重复自动去重）→ 写入 `crawl_runs`（fetched/imported/skipped/error）；
- `POST /api/crawl-jobs/:id/run-now` 入串行队列立即执行，返回 202；
- 批量应用：`POST /api/email/apply-batch { minConfidence? = 0.8 }` → `{ applied, skipped, results[] }`，逐条容错（ADR-7：仍不直接改状态机）。

### 3.11 Outlook OAuth2（设备码流程，v1.1）

背景：微软自 2024-09 停用 Outlook.com/Exchange Online 基本认证，IMAP 需 XOAUTH2（imapflow 支持 `auth.accessToken`）。

- `POST /api/oauth2/start { tenant: consumers|organizations|common|<tenant-id>, clientId }` → `{ userCode, deviceCode, verificationUri, expiresIn, interval }`；
- `POST /api/oauth2/poll { tenant, clientId, deviceCode }` → `{ status: pending|slow_down|complete|expired|error, email? }`；complete 时自动落库：`settings.oauth2.token`（access/refresh token）+ `email.config`（authMode=oauth2，host=outlook.office365.com:993）；
- access token 过期前 5 分钟自动用 refresh token 刷新；刷新失败清理令牌并提示重新授权；
- `GET /api/oauth2/status` / `POST /api/oauth2/disconnect`；
- 用户需自备 Azure 应用（Client ID）：「移动和桌面应用程序」重定向 + 允许公共客户端流。

## 4. 状态流转规则表（服务端校验依据）

| 当前状态 | 允许流转到 |
| --- | --- |
| WISHLIST | APPLIED, REJECTED, WITHDRAWN |
| APPLIED | SCREENING, WRITTEN_TEST, INTERVIEW_1, INTERVIEW_2, INTERVIEW_3, HR_INTERVIEW, OFFER, REJECTED, WITHDRAWN |
| SCREENING | WRITTEN_TEST, INTERVIEW_1, REJECTED, WITHDRAWN |
| WRITTEN_TEST | INTERVIEW_1, INTERVIEW_2, REJECTED, WITHDRAWN |
| INTERVIEW_1 | INTERVIEW_2, INTERVIEW_3, HR_INTERVIEW, OFFER, REJECTED, WITHDRAWN |
| INTERVIEW_2 | INTERVIEW_3, HR_INTERVIEW, OFFER, REJECTED, WITHDRAWN |
| INTERVIEW_3 | HR_INTERVIEW, OFFER, REJECTED, WITHDRAWN |
| HR_INTERVIEW | OFFER, REJECTED, WITHDRAWN |
| OFFER | SIGNED, REJECTED, WITHDRAWN |
| SIGNED / REJECTED / WITHDRAWN | 仅支持 `reopen` 操作 → APPLIED |

> 终态提供「重新打开」：`POST /transitions { toStatus: "APPLIED", reopen: true }`。
