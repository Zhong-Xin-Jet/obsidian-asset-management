# obsidian-asset-management

Obsidian 桌面端资产管理插件，最低版本 1.5.0。支持实物、虚拟订阅、永久授权、金额预付、次数预付的基础创建、编辑、删除及购买金额记录。本版本不加载封面资源。

## 构建与测试

使用 Node.js 22，无第三方依赖，无需 `npm install`。

```bash
npm test
npm run build
npm run release
```

也可直接调用 Node（本机托管版本示例，PowerShell）：

```powershell
& "C:/Users/24049/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" --test tests/*.test.cjs
& "C:/Users/24049/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" scripts/build.cjs
& "C:/Users/24049/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" scripts/release.cjs
```

`src/main.js` 为入口源码，`src/store.js` 为持久化层，`src/asset-actions.js` 为资产与事件修改逻辑，`api/` 为数据契约和投影。根目录 `main.js` 为自动生成 bundle，不应直接编辑。构建递归收集静态相对 CommonJS require，并保留 `obsidian` 为唯一外部模块；不支持动态 require 或其他包依赖。

`release` 先执行测试，再构建 bundle，输出 `dist/main.js`、`dist/manifest.json`、`dist/styles.css` 及 `dist/asset-management-0.1.0.zip`。ZIP 使用 Node 实现 STORE 方法和 CRC32，包含 `asset-management/` 下的三个安装文件，固定时间戳以保证相同输入产物一致。

## 手动安装

1. 执行 `npm run release`。
2. 将安装 ZIP 解压到 Vault 的 `.obsidian/plugins/` 下，得到 `.obsidian/plugins/asset-management/{main.js,manifest.json,styles.css}`。也可创建该插件目录并直接复制 `dist` 中三个标准文件。
3. 在 Obsidian 设置中开启社区插件及 Asset Management。

升级前先备份 Vault 内 `.asset-management/data.json`。安装包不含数据、`api/`、图标或额外样式资源；插件只需要三个标准文件。

## 数据安全与局限

- 默认数据为 Vault 内 `.asset-management/data.json`，直接使用 `vault.adapter`，不依赖隐藏目录索引。
- 数据路径固定于插件加载时。设置页只读展示，不自动迁移；已有位于 `.asset-management/` 内的合法 JSON 路径仍可使用。若手工修改插件设置中的路径，必须先备份并重启插件。禁止绝对路径、路径逃逸、Windows 非法路径字符及任何 `.obsidian` 段。
- 安全重载按钮只从同一文件重新读取，不保存或迁移。解析、读取、结构、资产/财务验证失败会锁写；无效资产或未知资产/事件字段不被过滤，需备份原文件并手工修复后重载。未知顶层及包装字段原样保留。
- 每次修改串行执行 clone → mutate → validate → save，仅保存成功后替换内存。保存前逐字比较原始磁盘文本，外部修改、删除或新建文件会锁写。
- Obsidian adapter 不提供跨进程 compare-and-swap。最后一次比对和 write 之间仍有很小的外部竞争窗口；write 也不是断电安全事务。本实现遇写失败会回滚内存并锁写，但不能保证恢复操作系统中途写坏的文件。不要让多个插件实例/同步工具同时写同一文件，请保留独立备份。
- 内存 JSON 导出不等同于原始文件备份。损坏 JSON 无法解析时，导出可能是空/上次读取的内存视图；请直接复制原始 `.asset-management` 数据文件。
- 金额以货币最小单位安全整数存于财务侧记录；新增创建 purchase 事件，更正追加 replacesEventId 并作废旧事件，不向实体添加金额字段。旧初版未持久化的金额无法自动恢复；需要重新输入。多条有效 purchase 事件不支持简易表单更正。
- 编辑不允许改变 kind；种草资产仅编辑名称。删除资产会级联删除 wishlist、operationLogs、maintenance、usage、prepaidTransactions、financialEvents、lifecycleEvents、subscriptionPeriods 中该资产的侧记录。
- 当前为基础移植，订阅周期、预付充值/消费、维护、使用记录等完整业务界面尚未实现；封面、资源上传和移动端未测试，manifest 限定桌面端。
- 已验证 Node 内置回归测试及 Obsidian mock，不代表已通过真实 Obsidian 桌面 UI/同步/文件系统的端到端验证。

## GitHub 发布

`.github/workflows/release.yml` 在推送 Tag 后测试、构建并上传三个标准文件及安装 ZIP，创建 GitHub Release。Tag 必须为 manifest 版本（例如 `0.1.0` 或 `v0.1.0`），package 与 versions 必须同步更新。这里仅提供工作流，不自动打 Tag、提交或推送。
