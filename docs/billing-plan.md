# P6 多租户计费方案（Draft — 未执行）

> 目标：给 DreamLand 多租户 SaaS 加**计费 / 配额 / 订阅**能力，把「模型 API 成本」分摊到用户，实现商业化。
> 现状：已有 JWT 账号 + 进程内 rate-limit（Phase 2，重启清零），无计费、无持久配额、无支付。

## 1. 目标与原则

- 一个后端服务所有注册用户，**按账户计费**。
- 模型调用成本（token 消耗）是主要计费依据。
- 服务端**强制**配额与限流（不能信任客户端）。
- 密钥/支付凭据只存服务端、只显掩码。

## 2. 计费模型（三选一或组合，建议先做「套餐 + 用量」）

| 模型 | 说明 | 适合 |
|---|---|---|
| **订阅套餐** | 免费档 / 付费档（月付/年付），每档含 token 额度 + 速率上限 | 最简单、易理解，**建议先做** |
| **按用量计费** | 按 token / 消息数计费，超出套餐额度按量加收 | 精细化，与套餐叠加 |
| **预充值** | 用户充值余额，按量扣减 | 国内习惯，可后期加 |

**推荐路径**：先做「订阅套餐（含 token 月额度）+ 超额按量」的最小闭环，支付先接一个（Stripe 或支付宝/微信）。

## 3. 数据模型（新增，服务端持久化，非进程内存）

```
plans（套餐表）
  id, name, price, currency, token_monthly_quota, rate_limit_rpm, models_allowed[], features

accounts（在现有 users.js 账号上扩展，或独立 billing 表）
  handle, plan_id, token_used_this_cycle, cycle_start, balance_cents,
  status(active/trial/suspended), trial_ends_at

payments / invoices
  id, handle, plan_id, amount, currency, provider, provider_ref, status, created_at

usage（token 消耗流水，用于对账/超限）
  id, handle, model_id, prompt_tokens, completion_tokens, created_at
```

存储建议：新增 `src/billing/`（一个 SQLite 或沿用 node-persist 的文件存储；多租户规模不大时文件存储够用，规模上来再换 Postgres）。

## 4. 架构改动

```
客户端
  │  登录(JWT) → 附带 account 的 plan / quota
  ▼
/api/v1/chat/:id/generate
  │  （1）先过 JWT 鉴权
  │  （2）读账户 plan → 检查 token 额度 + rate_limit
  │  （3）模型网关出 token（已有）
  │  （4）累计 token 用量 → 落 usage + 更新 quota
  ▼
模型网关 → 供应商
```

- **配额中间件**：新增 `src/billing/quota.js`（在 `/api/v1/chat/generate` 前校验 token 额度与 RPM；超额返回 402/429）。
- **计费服务**：新增 `src/billing/`（plan 管理、订阅、用量累计、webhook）。
- **支付回调**：`/api/v1/billing/webhook`（Stripe/支付宝/微信的支付结果回调，验证签名后落库）。
- **管理端**：`/api/v1/ops/billing`（套餐 CRUD、查看用户订阅/用量、手动改余额/档位、暂停/恢复），UI 加到 `/ops`。

## 5. 分阶段任务（建议顺序）

- **B1 配额持久化**：把 Phase 2 的进程内 rate-limit 升级为持久化配额（token 月额度 + RPM + 余额），`src/billing/quota.js` 中间件接入 chat/generate；超额返回明确错误码。
- **B2 套餐与账户扩展**：新增 plans 表 + 账户 plan 字段；免费档默认、付费档可切；admin 在 /ops 管理套餐。
- **B3 支付接入（先一个）**：Stripe（国际）或 支付宝/微信（国内）二选一；订阅/支付 + webhook 落库 + 自动激活/续费/降级。
- **B4 用量与对账**：token 用量流水落库；/ops 显示每用户用量、套餐、余额、账单。
- **B5 用户侧 UI**：Web/移动端加「套餐 / 用量 / 充值」页面；超限时引导升级。

## 6. 安全与边界

- 支付回调必须**验签**（Stripe signature / 支付宝 RSA / 微信签名），不能裸接收。
- 配额判定在服务端（`quota.js`），客户端只读展示，不可信。
- 超额错误码建议：429（速率）与 402（额度/欠费）分开，方便客户端提示。
- 金额用**分（cents）**整数存储，避免浮点误差。
- 冻结/暂停账户要立即生效（quota 中间件读最新状态）。

## 7. 待确认（执行前拍板）

1. 先接哪个支付？（Stripe 国际 / 支付宝 / 微信 / 先不做支付只做配额）
2. 套餐档位怎么定？（免费额度多少、付费月费多少）
3. 计费按「token」还是按「消息数」？（token 更准，消息数更简单）
