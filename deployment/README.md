# YUAN DESIGN BUILD 部署准备记录

本轮范围：检查现有权限和部署能力，执行只读诊断、构建验证和隔离部署准备。没有购买资源、创建收费服务、修改 DNS、改变 WordPress 文件、执行数据库迁移或发布生产环境。

## 已取得的证据（2026-10-18）

| 项目 | 实际结果 |
| --- | --- |
| 终端 | Node.js 24.19.0、npm 11.9.0、Python 3.12.14、Git 2.52.0、OpenSSH 和 SFTP 可用 |
| 浏览器 | Chromium 154 和 Python Playwright 可用；云环境没有已开放的外部预览能力 |
| Git 读取 | `git ls-remote origin HEAD refs/heads/main` 成功 |
| Git 推送预检查 | 新分支 `codex/deployment-readiness` 的 `git push --dry-run` 成功；此检查本身没有创建远程分支 |
| GitHub API | `gh api repos/please2612-afk/drcoration-crm-pro` 返回 Forbidden；有现成 Git 凭据，不应因此重复索要 GitHub Token |
| Render / Dinahosting | 未发现可用 API 绑定或 SSH agent；API/文档 HTTPS 请求在代理 CONNECT 阶段被 403 拒绝 |
| 三个业务域名及 www | HTTPS 请求在代理 CONNECT 阶段被 403 拒绝；本机 DNS 查询亦无可用结果，不能据此推断网站下线或 DNS 未配置 |
| 应用基线 | 48 项业务/接口测试通过，构建成功，Worker ESM 产物检查通过 |
| PostgreSQL / HTTPS / DNS | 未获得真实服务连接、记录或证书信息，均未验证；未初始化任何远程数据库 |

完整原始诊断见 `evidence/2026-10-18-network.json` 和 `evidence/2026-10-18-preflight.json`。其中仅记录状态、变量是否存在和公开主机名，没有密钥值。Git 分支后续是否真正发布，以 Git 命令输出及远端 SHA 验证为准，不以 dry-run 代替。

## 可以立即自动执行的工作

1. 保留现有 WordPress 官网；检查工具、Git、构建、测试和现有代码，不接触官网文件和数据库。
2. 重跑只读部署检查：`node --use-env-proxy deployment/preflight.mjs --network`。退出码 2 表示部署条件未满足，不能当作部署成功。
3. 校验隔离及费用限制：`node --test deployment/preflight.test.mjs`。
4. 将源码及准备材料保存到独立 Git 分支，校验远端提交；不修改 `main`。
5. 保存最小网络和 API 凭据需求到环境配置草稿；这不会应用网络、创建服务、配置凭据或发布应用。

## 源码不能直接部署到 Render 的原因

现有 `app/server.js` 使用 Worker 风格请求入口、D1 的 `prepare/bind/first/run` 和 R2 的 `BUCKET`。`scripts/dev.mjs` 使用本机 SQLite，并把每个请求固定为本地负责人。该服务只监听回环地址，不能作为公网生产后端。

Render/PostgreSQL 适配至少还需要：

- 独立 Node HTTP 入口，监听 `0.0.0.0` 和平台提供的 `PORT`；正确处理反向代理和请求体限制。
- PostgreSQL 查询和并发更新适配。SQLite 的 `?` 占位符及 `INSERT OR IGNORE` 不能原样用于 PostgreSQL。
- 私有、持久化资产存储。小型测试环境可评估 PostgreSQL BYTEA，减少额外存储服务数量；Render 临时文件系统不能保存唯一的图纸/照片副本。生产容量、备份和恢复需单独验证。
- 可信身份验证入口和指定负责人初始化。Render 不会自动提供受保护的 `oai-authenticated-user-*` 头，不能信任客户端自行发送的头，也不能公开固定负责人开发身份。
- 对上述适配进行真实 PostgreSQL、角色权限、重启持久化及恢复测试。当前 48 项测试通过不等于 Render/PostgreSQL 已通过。

因此本轮没有生成会把开发服务器错误上线的 Render Blueprint，也没有启用自动部署。`postgres/001-staging-schema.DRAFT.sql` 是待验证的、仅新增表的迁移草案：严格限制目标数据库为 `yuan_build_os_test`，未执行、未在 PostgreSQL 验证，不代表适配已经完成。

## 隔离布局

| 层 | 官网 | 测试环境 | 生产环境 |
| --- | --- | --- | --- |
| 访问地址 | `https://yuandesignbuild.com` | `https://test.yuandesignbuild.com` | `https://app.yuandesignbuild.com` |
| 主机 | 继续使用现有 Dinahosting WordPress | Render 独立服务，待创建 | Render 另一独立服务，尚不发布 |
| 数据库 | 现有 WordPress 数据库，不接触 | 独立 PostgreSQL `yuan_build_os_test` | 独立 PostgreSQL `yuan_build_os_production` |
| 资产与密钥 | 保持原配置 | 仅测试资料和测试密钥 | 独立生产资料和密钥 |
| DNS | 不改 @、www、NS、MX、TXT、CAA | 核实既有记录后，仅提出/设置 test 记录 | 待测试验收及生产授权后处理 |

以上应用域名是用户指定的目标地址，当前不能从本环境证明它们已经可访问。数据库及服务名称是规划值，不是已创建的资源。

## 最少人工操作：一次配置授权

在 Codex 环境设置中一次性审核保存网络及凭据要求，安全填入：

- `RENDER_API_KEY`：用于官方 `api.render.com` API。无需手动先创建服务或数据库；账户/资源选择可在 API 可用后自动检查。
- `DINAHOSTING_API_USER` 与 `DINAHOSTING_API_PASSWORD`：用于官方 `dinahosting.com` API。后续先检查 API 文档、实际域名所属账户及授权，再操作 test 子域。无需同时提供 WordPress 管理员、SFTP 或 SSH 密钥。

密钥值不要写入聊天、源码、GitHub、日志或本文件。PostgreSQL 的 `DATABASE_URL` 应由服务端安全配置到 Render 对应环境；不要把数据库密码当作可写入源码或通用 HTTPS 占位符的变量。

配置草稿保存不等于生效：需在环境设置审核、保存并发布环境，确认网络/凭据已注入后重跑检查。现有 Git 凭据继续复用；GitHub API 的 Forbidden 需先排除网络，不要求重复提供 Token。

不需要你现在手工创建 DNS 记录。取得 Render 实际服务目标、验证应用和现有 DNS 后，才生成具体 test 记录；不会填写虚构的 `.onrender.com` 目标，也不会更改主域名或邮件记录。若 Dinahosting 不支持所需授权，届时才提供一次准确的子域记录操作。

## 恢复授权后的执行顺序

1. 仅通过只读官方 API 核实 Render 所属账户、现有资源、当期免费层条款/数据库生命周期、区域及 Dinahosting DNS 记录。官方文档待网络恢复后核实：`https://render.com/docs`、`https://render.com/docs/postgresql`、`https://dinahosting.com/api`。
2. 完成并验证 Render/PostgreSQL/身份适配，生成与实际运行入口对应的 Blueprint；禁止直接上线本地开发服务器。
3. 核实确有零新增费用的测试选项后才创建隔离测试资源；如需收费、信用卡或套餐变更，停止于具体价格和方案，取得用户确认。生产稳定性及备份不能用未经核实的“永久免费”承诺代替。
4. 初始化新测试数据库、验证持久化、权限、AI 降级和 `/api/health`，记录实际 Render URL 与响应结果。
5. 核实 test 既有 DNS 后，仅配置测试子域；用正常 TLS 验证检查证书、HTTPS 和业务请求。HTTPS 由托管平台签发，不购买不必要的证书。
6. 提交实际访问地址和测试结果供验收；生产保持独立，另行核实上线授权与费用，不复制测试密钥或误用测试数据库。

`targets.json` 中的发布标志和待验证 gates 保持 false。这是如实记录阻碍，不是可上线证明。当前没有更改 Dinahosting、Render、官网或远程数据库。
