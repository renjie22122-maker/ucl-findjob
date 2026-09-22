# 智能推荐与 LinkedIn 辅助

## 1. 目标与边界

智能推荐把「简历 → 搜索画像 → 岗位发现 → 匹配排序 → 投递记录」串成可追踪闭环：

1. 从简历的目标岗位、技能和所在地派生搜索条件；
2. 通过已注册的数据源适配器发现岗位；
3. 按岗位标题、JD 技能和城市进行确定性匹配；
4. 将达到阈值的岗位保存到推荐收件箱；
5. 用户确认后导入投递管理，并自动关联所用简历。

当前自动数据源为牛客网。LinkedIn 采用合规辅助模式：FindJob 只生成可复制的搜索文本，并对用户本人粘贴回来的岗位信息做本地匹配；不登录 LinkedIn、不抓取页面、不构造自动访问流程、不模拟点击，也不自动提交申请。

## 2. 使用流程

### 2.1 自动推荐

1. 在「简历管理」维护目标岗位、技能和城市；
2. 进入「智能推荐」，新建搜索画像并选择简历；
3. 留空关键词可让后端自动派生，也可手动覆盖关键词、城市、岗位类型和匹配阈值；
4. 选择手动、每日或每周运行。服务运行期间，调度器每分钟检查是否到期；
5. 在推荐收件箱查看分数和理由，执行收藏、忽略、恢复、单条或批量导入；
6. 导入后岗位进入「投递管理」的待投递状态，并关联画像使用的简历。

### 2.2 LinkedIn 辅助

1. 在画像卡片打开「LinkedIn 辅助」；
2. 复制 FindJob 生成的关键词、graduate/internship 和城市组合；
3. 由用户本人在 LinkedIn 中搜索和核对岗位；
4. 将公司、岗位、城市、公开链接与 JD 粘贴回 FindJob；
5. FindJob 在本地计算匹配度，保存到同一推荐收件箱；
6. 用户确认后再导入投递管理，并在 LinkedIn 中自行完成提交。

## 3. 搜索画像派生

当关键词未填写或显式清空时，后端会使用：

- `resume.targetRole` 作为首要关键词；
- 目标岗位与前六项技能的组合，例如 `后端开发工程师 TypeScript`；
- `resume.basic.city` 作为默认城市；
- 画像中手动填写的城市优先于简历城市参与匹配。

单个画像最多保存 8 个关键词、5 个城市和 5 个数据源。每次运行最多使用前 6 个关键词，以控制抓取次数和上游压力。

## 4. 匹配与去重

- 有可用结构化 JD 时，匹配会综合岗位相关性、JD 要求技能命中和城市；
- 技能缺口只报告 JD 要求但简历未体现的技能，不再把简历的额外技能误判为缺口；
- 无 LLM 配置时使用确定性本地规则，推荐链路仍可运行；
- 来源有稳定 `sourceKey` 时直接使用；否则优先规范化 JD URL，再退化为公司、岗位和城市组合的 SHA-256 标识；
- 推荐表以 `profile_id + source_id + source_key` 唯一约束去重；再次发现时更新内容和最后发现时间，并保留用户已设置的状态。

## 5. 调度与失败处理

- `manual`：仅用户点击时运行；
- `daily`：距上次运行至少 24 小时；
- `weekly`：距上次运行至少 7 天；
- 推荐任务与普通抓取任务共用串行队列，避免同时访问上游；
- 单个关键词或来源失败时继续处理其余组合，并在运行记录中保留部分失败信息；
- 所有组合均失败时运行标记为 `failed`；失败也记录本次时间，避免每分钟无限重试。

调度只在 FindJob 服务运行时生效；应用关闭期间不会后台执行，重新启动后会补查已到期任务。

## 6. 数据模型

| 表 | 用途 |
| --- | --- |
| `job_search_profiles` | 简历、关键词、城市、来源、阈值、频率和自动导入设置 |
| `recommendation_runs` | 每次运行的抓取数、匹配数、保存数、导入数和错误信息 |
| `job_recommendations` | 推荐岗位快照、分数、理由、状态及关联申请 |

推荐状态：`new`、`saved`、`dismissed`、`imported`。

## 7. API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET/POST` | `/api/recommendations/profiles` | 查询/创建画像 |
| `PUT/DELETE` | `/api/recommendations/profiles/:id` | 更新/删除画像 |
| `POST` | `/api/recommendations/profiles/:id/run` | 串行执行画像 |
| `GET` | `/api/recommendations/profiles/:id/linkedin-plan` | 返回纯文本 LinkedIn 搜索方案 |
| `GET` | `/api/recommendations` | 分页筛选推荐 |
| `POST` | `/api/recommendations/manual` | 保存用户主动粘贴的岗位并匹配 |
| `PUT` | `/api/recommendations/:id/status` | 收藏、忽略或恢复 |
| `POST` | `/api/recommendations/:id/import` | 导入单条推荐 |
| `POST` | `/api/recommendations/import-batch` | 批量导入推荐 |
| `GET` | `/api/recommendations/runs` | 查询运行历史 |

手动岗位的公司官网和 JD URL 仅接受 HTTP(S) 地址。请求体使用严格校验，未知字段会被拒绝。

## 8. LinkedIn 集成判断

LinkedIn 的公开自助 API 不提供通用职位搜索与求职者自动投递能力；Job Posting 和 Apply Connect 属于受限的合作伙伴/ATS 场景。LinkedIn 也明确禁止未经许可的抓取、机器人和自动化交互。因此本项目不把网页自动化伪装成“集成”。

如果未来获得 LinkedIn 正式合作伙伴权限，可新增独立适配器，并满足以下条件：

- 只使用获批 API、OAuth 范围和用途；
- 在适配器注册表中显式注册，并遵循统一限速、审计和错误隔离；
- 不把用户令牌写入日志；
- 申请提交仍提供清晰确认步骤，不绕过平台限制；
- 在上线前补充契约测试和平台合规复核。

参考：

- [LinkedIn API Access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
- [Apply Connect Overview](https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/apply-connect-overview)
- [Job Posting API Overview](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview)
- [LinkedIn Prohibited Software and Extensions](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions)

## 9. 验收覆盖

自动化测试覆盖画像派生与校验、简历城市覆盖、运行成功/部分失败/全部失败、阈值过滤、推荐去重、状态保留、手动 LinkedIn 岗位、HTTP(S) URL 边界、单条/批量导入以及 API 端到端闭环。集成测试使用内存数据库，不污染本地求职数据，也不会访问 LinkedIn。
