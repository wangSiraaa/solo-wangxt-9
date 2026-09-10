# TLS 证书轮换工作台

集中管理 **域名、证书链、部署节点、部署计划与切换记录** 的灰度轮换系统。
前端 Vue 3（Vite），后端 NestJS，数据库 PostgreSQL。
**私钥不进入本系统**——上传接口只接受证书 PEM，检测到 `PRIVATE KEY` 直接拒绝。

## 目录

```
backend/           NestJS + TypeORM + PostgreSQL
  fixtures/        OpenSSL 生成的演示证书（根/中间 CA + 多版本叶子，私钥已全部销毁）
  src/cert         证书上传与链校验（Node 内置 crypto.X509Certificate，无 openssl 运行依赖）
  src/deployment   部署编排：灰度→确认→全量→暂停/恢复/重试/回滚
  src/simulator    本地节点模拟器（超时 / 重复回执 / 首次失败 / 正常）
  src/nodes        节点、行为注入、回滚候选、演示数据种子
  src/dashboard    到期清单 + 节点矩阵聚合
frontend/          Vue 3 SPA（无 UI 框架，原生组件 + 轮询）
scripts/start-db.sh 用户态 PostgreSQL 启停（无 root/Docker 环境用）
```

## 快速启动

需要 Node 20+ 与一个 PostgreSQL 14+ 实例。

```bash
# 1) 数据库（已有 PostgreSQL 可跳过，用 backend/.env 指向现有实例）
scripts/start-db.sh

# 2) 后端
cd backend
npm install
cp .env.example .env
npm run start:dev          # http://127.0.0.1:3000 ，首启自动建表 + 演示数据

# 3) 前端
cd ../frontend
npm install
npm run dev                # http://127.0.0.1:5173 ，/api 代理到 3000
```

演示数据：3 个受管域名；1 张 **18 天后到期** 的 `v2-即将到期` 证书（5 个节点都在跑它）；
5 个节点——1 个 canary（正常）、4 个 bulk，其中预置了 超时 / 首次失败 / 重复回执 三种行为。
`fixtures/` 里另有 `chain-v3.pem`（新通配符证书，可直接上传）、`chain-v1.pem`（已过期，用于观察拒绝）、
`chain-other.pem`（域名不匹配，用于观察拒绝）。

## 上传时的三重核对

1. **有效期**：叶子及链上每张证书当前都必须在 notBefore/notAfter 内；
2. **证书链**：每张证书由后一张证书有效签名（`X509Certificate.verify`），链尾必须自签名根，顺序 叶子→中间→根；
3. **域名覆盖**：叶子 SAN 必须覆盖至少一个受管域名，返回逐域名覆盖矩阵；通配符只匹配单级标签（`*.example.com` 匹配 `api.example.com`，不匹配 `a.b.example.com` 或裸域）。

同一叶子指纹不可重复入库（409）。

## 发布流程与状态机

```
draft ──canary──▶ canary_running ──全成功──▶ awaiting_approval ──advance──▶ bulk_running
                      │                          │  (灰度未过禁止推进 409)          │
                      └────任一失败──▶ canary_failed                                 ├─全部成功─▶ complete
                                                                                    ├─有失败──▶ partial
bulk_running ──pause──▶ paused（未下发项 skipped，保持旧版）──resume──▶ bulk_running
任意非终态 ──rollback──▶ rolled_back / rollback_failed
```

- **分批发布**：先只下发 canary 节点；canary 全成功并人工“推进”后才动剩余节点。
- **失败隔离**：某节点失败/超时不影响其他节点，节点实际版本以其回执指纹为准，矩阵实时显示每个节点最终指纹。
- **超时**：后端等待窗口 5s；窗口内无回执先判 `timeout`，节点迟到的成功回执仍被采纳（`timeout→success`）。
- **重复回执**：按每次下发的随机 `requestToken` 幂等去重，重复/过期回执写入流水但标记 `accepted=false`，不覆盖结果。
- **单节点重试**：失败/超时条目可单独重试（生成新 token），不重跑其他节点。
- **回滚安全规则**：只回滚“实际已切到新版本”的节点；目标必须 **仍在有效期内且 SAN 覆盖该节点域名**。
  优先回到轮换前基线；基线已中途过期时自动改选最新的其他有效匹配证书；没有任何安全候选则整单拒绝（400）。

## 节点模拟器

`POST /api/nodes/:id/behavior` 设置固定行为，`POST /api/nodes/:id/inject` 只影响下一次下发：

| 行为 | 表现 |
|---|---|
| success | 随机 200–900ms 后成功，指纹切为目标 |
| timeout | 处理 >5s，先产生超时，随后迟到成功回执 |
| duplicate | 成功后补发一条相同回执（第二条应被忽略） |
| flaky | 第一次失败且节点保留旧指纹，重试后成功 |

页面「🧪 节点模拟器」可直接切换，并查看每节点的可回滚证书候选。

## 主要接口

- `GET /api/dashboard` 到期清单 + 节点矩阵 + 统计
- `POST /api/certificates`（JSON `{label,pem}`）/ `POST /api/certificates/upload`（multipart）
- `GET/POST /api/domains`、`GET /api/nodes`、`POST /api/nodes/:id/behavior|inject`
- `POST /api/plans`、`POST /api/plans/:id/canary|advance|pause|resume|rollback`
- `POST /api/plans/:id/items/:itemId/retry`
- `GET /api/plans/:id`（plan + items + receipts 回执流水 + events 审计事件）

## 设计说明

- 证书链 PEM 是公开材料，随元数据入库；系统全链路不接触私钥，节点模拟器用“目标指纹”代替真实证书加载。
- TypeORM `synchronize: true` 便于演示；生产应改为迁移。
- 节点版本只在回执指纹与目标证书指纹一致时更新，防止错误回执污染矩阵。
