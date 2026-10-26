# ChatGPT 接口研究与接入依据

## 2026-10-24 图像请求实测补充

- 一次双路实测两路均生成真实图片；一次六路提交实测一张成功、五条助手最终回复提示每日额度耗尽，报告约 19 小时 58 分钟冷却。六个 POST 的开始时间相差约 27.1 秒，存在请求重叠；这不证明服务器固定允许五路并发。
- 六路的流捕获中途被浏览器控制超时打断，因此没有完整六路 SSE/HTTP 状态证据。随后读取各会话结果均为 HTTP 200；成功项存在 `tool` 消息、`image_asset_pointer`、`finished_successfully` 与最终任务状态，其余五条无图像结果，也未见独立结构化错误。
- 之前单路失败捕获了完整 39 帧流（含 `[DONE]`），每日额度与等待时长出现在助手最终文字；同一流的 `conversation_detail_metadata` 仍报告 `image_gen.remaining=120`、`blocked_features=[]`。因此 120 不能解释成这条生成路径可用图片数。
- 用户报告约五路以上可能出现 1／5／8 分钟短冷却；本轮未复现该短时并发限流，当前实现已移除并发、短时限流和稍后重试分支，也不从 HTTP 429 推断每日额度。
- 接入仅转发每日上限报告或实际出图成功信号。每日上限直接覆盖原有图像生成行，显示“已达到上限”及本地预计恢复时间，并标注助手回复来源。到时转为“待确认恢复”，未校准的 120 不能确认恢复；实际出图清除，新的每日上限报告更新时间。不保存原始流、聊天文字、账号标识或认证材料。
- 预计恢复时间不限制用户发起请求，提前成功出图会立即清除旧上限。状态与缓存按账号隔离；换号清空显示并丢弃旧请求晚返回的结果及旧消息流。切回原账号时重新检查缓存的恢复时间，已到期则显示待确认。主动查询也传回账号范围及请求时间，防止缓存退回未区分账号的状态。
- 精简实现改为收到完整响应后统一判断，移除独立实时解析器和请求正文读取；会话关联仅取响应中的 ID。保留 2 MiB／120 秒的临时读取上限，响应副本处理结束即丢弃，网页仍立即获得原响应。

记录日期：2026-10-02。研究目标是找到能为 RateBucket 提供真实数值、明确余量或服务端校准信息的接口。本文不是当前读数缓存，也不声称已发现全部私有接口。

## 已取得实质性数据的入口

| 入口 | 方法 | 可用字段 | 正确语义 | 验证 |
|---|---|---|---|---|
| `/files/library/storage/usage` | GET | `used_bytes`, `allowed_bytes`, `remaining_bytes`, `is_over_limit` | 当前文件库容量与直接余额 | 10 月 2 日再次 200；已用与剩余之和等于总量 |
| `/accounts/{account_id}/remaining_balance` | GET | `balance` | 额外 Credits 余额 | 10 月 1 日 200；支持十进制字符串 |
| `/wham/rate-limit-reset-credits` | GET | `available_count` | 可用套餐限额重置机会数量 | 10 月 2 日再次 200 |
| `/premium-usage/summary/v2` | GET | `features[].feature`, `uses_7d`, `uses_28d` | 图像等功能的历史使用总计 | 10 月 2 日再次 200；当前窗口为 7 日 |
| `/automations/query` | POST，只读 | `items`, `cursor` | 完整分页后的个人活跃任务数量 | 10 月 1 日 200；所有返回记录均为 active |
| `/automations/schedule_policy` | GET | `max_iterations_per_hour`, `minute_schedule_available` | 单任务运行频率政策 | 10 月 1 日 200 |
| `/subscriptions?account_id=...` | GET | `plan_type`, `is_active`, `active_until`, `will_renew` | 当前周期期限与续订状态 | 10 月 1 日 200；返回对象，不是数组 |
| `/subscriptions/auto_top_up/settings?include_payment_method=false` | GET | `is_enabled`, `recharge_monthly_remaining` 等 | 自动补充配置与月度可用读数 | 10 月 1 日 200；当前关闭且余量为 null |
| `/wham/usage/thread_usage/query_v2` | POST，只读 | `five_hour_limit_percent`, `weekly_limit_percent`, `data_status` | 单个任务贡献的套餐消耗 | 10 月 1 日 200；含真实历史出图任务 |

上述相对路径均属于 `https://chatgpt.com/backend-api`。

## 图像额度校准结论

1. 官网普通生图成功消息与失败消息均已检查；没有发现独立的图像 `remaining`。
2. 已有两个不同 generation ID 的真实成功事件后，`conversation/init` 仍返回 `image_gen.remaining=120`，因此不能把这个值当作该生图路径的逐次余额。
3. `premium-usage/summary/v2` 返回的 `image_generation.uses_7d` 是服务端历史功能使用统计，不是剩余张数，也未证明等于成功图片数或扣额单位。不能用 `120 - uses_7d` 算余量。
4. `wham/usage` 的图像限额横幅需要客户端提供限额标记；控制实验确认其 `reset_at` 可以精确采用客户端提供的时间，不是独立查询出的恢复时间。
5. `ChatGPTAgentToolRateLimitException` 是真实工具限额状态源；原生图像项目还支持 `usageLimitExceeded / limitId / resetsAt`。它们能证明限额状态，不提供剩余张数。
6. `message.metadata.image_gen_delayed.resets_after` 是另一个有代码依据的服务端恢复时间载体；当前失败会话样本没有该结构。不能按仅有代码支持就填出时间。

## 尚未取得数据与错误含义

| 入口 | 本账号已见结果 | 结论 |
|---|---|---|
| `/accounts/{account_id}/spend-controls/current-user/monthly-usage?supports_usage_limit_modes=true` | 401，明确要求 workspace account | 这是账号类型不适用，不能一律显示“登录过期” |
| `/wham/usage/thread_usage/query` | 403 | 原版未取得数据；新版已成功，不能用原版失败否定所有任务用量 |
| `/wham/usage/credits/estimate` | 403 | 当前未取得估算；不影响已验证的直接余额入口 |
| `/wham/usage/plan_limit_balance_history` | 404 | 当前未取得余额曲线，不从空响应填零 |
| `/wham/usage/stream` | 404 | 前端支持 SSE，但当前账号未取得快照流 |
| `/codex/usage` | 曾 200，后出现 403 HTML | 需要响应类型检查与已验证的 WHAM fallback，不能沿用旧成功状态 |

历史统计入口也曾间歇返回 HTML 错误；最近一次成功值必须保留原校验时间，不能把错误变成 0。

`/files/library/mounted/capabilities` 已实测 200，内容是挂载来源的可用能力，不是容量或调用余额，不能误当新的 quota 入口。

## 当前可计数但不等于额度的两类入口

### 自动化

已验证的只读 POST 参数为 `scope=personal`、`status=active`、`q` 为空、`limit=25`、`cursor` 从 null 开始、`sort=updated_at_desc`。

按任务 ID 去重并取完 cursor，才可显示精确活动数。没有发现服务器最大 slots 字段，不填固定的 10，不计算剩余 slots。`limit=25` 只是分页大小。

频率政策里的正数用于验证单个任务周期；`max_iterations_per_hour=-1` 的 UI 语义是不限制该频率，0 则不提供可选运行周期。它不是账户每小时剩余执行数。

### 图像与其他高级功能历史使用

Premium summary 必须同时满足 `status=ready` 和 `available_windows` 含所读取的窗口。`uses_28d=null` 不等于零。`free_access` 是转到 Free 后的能力比较，不代表当前账号耗尽。

`standard_free_limit_exceeded_action_count_7d` 是订阅对比所用的标准 Free 门槛保守下界，不是当前 Plus 的图像限流次数。

## 事件来源

公开语音客户端处理 `RelayMessageProcessed.payload.file_upload_usage.remaining` 和 `reset_after_seconds`，再更新 `file_upload` 的进度对象。它是新增附件校准来源，但本轮未连接语音取得现场 payload。

语音 `UsageUpdate` 的 UI 消费了限额提示、挂断状态；未发现被 UI 消费的独立剩余分钟字段。完整 payload 的实际验证仍需要合法现有语音会话，不伪造 proof/context，也不从时长推算“官方余量”。

## RateBucket 接入要点

- 额度、余额、统计、政策四类分开。容量 bytes 与次数不比较；历史使用不参与耗尽警报；额外 Credits 为 0 不代表套餐内额度为 0。
- `null`、不完整分页、401/403/404 和 HTML 错误不变成零。
- 当前账号必须参与缓存与合并范围；不能用空 account_id 构造账号路径。
- `query_v2` 字段明确是百分数，小于 1 的值不能套用比例猜测而扩大 100 倍。
- 真实图像阻断不能被后来未校准的 120 覆盖；现 normalizer 对 progress 与 blocked 同名时的行为需要单独验收。
- used-only 统计需要专属显示；容量需要 bytes 单位；无 reset 的统计不加恢复倒计时。
- 历史 freshness 与本次 checkedAt 区分。统计适合低频或按需读取，不沿用所有额度统一一分钟轮询。

## 对现有解析器的可重复检查

本轮用当前源码和人工构造的数据做了离线检查，不把测试数据当服务端读数：

- 输入 `primary_window.used_percent=1`，现解析结果为 usedPercent=100、remainingPercent=0。对协议明确为百分数的字段，这会把 1% 误当 100%，不是接口额度真的耗尽。
- 输入 `rate_limit_reset_credits.available_count=3`，现 normalizer 没有产生对应数量项。当前官网回应确有 available_count 和 applicable_available_count，可新增“可用重置机会”而不增加用量请求。
- 人工 workspace `spend_control.individual_limit` 中 remaining/limit 被现 generic parser 识别，因此不能说它完全未解析；缺口在单位、workspace 适用性与显示语义。官网以这组字段显示月度 Credits 剩余，并使用 reset_at。

当前个人账号实际的 individual_limit 为 null，没有现场月度预算数；只记录代码支持，不构造个人月度额度。

## 产物与验证范围

机器可读接入清单：`docs/chatgpt-endpoint-contracts.json`。清单只包含方法、路径、字段语义、验证状态和条件，不包含原始接口响应、账号标识、认证信息或聊天内容。

研究覆盖登录账号实际请求、当前官网已加载的前端资源、本机已安装桌面程序的只读源代码和原生协议；不是服务端全部接口穷举。没有执行购买、充值、取消订阅、创建任务或新增生图，也没有修改扩展运行代码、增加权限或发布版本。
