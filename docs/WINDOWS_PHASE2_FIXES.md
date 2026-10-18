# Windows 0.1.7 学案修复与项目用量

2026-10-18；仅 Windows。本记录追加在第二阶段交付之后，不覆盖此前验证边界。

## 原因与修复

- 整理题目误用通用请求的 2,000 输出 token 上限。只读检查用户报告的失败记录发现，每次输出均达到 2,000 且以 length 结束，随后同上限格式修正再次截断；日期标题并非此次失败原因。私人内容和原始记录不纳入仓库。
- 整理上限调整为 32,000，单题参考解答为 16,000，参考反馈为 4,000。Windows 对上限至少 16,000 的请求允许最多 600 秒等待，仍可取消。其他平台超时不变。上限并非固定实际消耗；不保证超大材料一定完成。
- 截断不再按相同参数自动重试；保留失败原稿。完整返回但格式错误仍最多校正一次。
- 新增单题与题组删除，移出当前练习；保留原材料、历史结构及作答。重新整理原题仍可能重新识别出已删除题目；此操作不删除来源文字。历史目前可查看与导出，没有一键撤销删除。
- 学案忙碌状态接入悬浮条全局取消。立即保存取消状态，晚到响应只留记录和服务端返回用量，不恢复当前解答。文档整理也纳入 Windows 全局取消。

## 用法与统计口径

设置 →「在悬浮条显示本项目 AI 用量」→ 保存。默认关闭。开启后最右侧显示累计 Token、`+最近一次`，输入/输出用小字分为两行，旁边显示缓存率；窄窗口必要时换行。

累计来自本项目已保存任务和学案尝试的 usage，包括失败、格式修正，避免将同一任务及其结果重复相加。支持历史记录回算；项目之间隔离。最近一次增量从本版本之后收到的返回开始记录。直接使用本地已保存答案不增加消耗。

缓存率是服务端已报告缓存字段的输入 token 加权命中率，兼容 prompt_cache_hit_tokens 与 prompt_tokens_details.cached_tokens；不是本地答案复用率，也不是账户余额或金额。供应商未报告缓存时显示「—」。取消或异常没有返回 usage 时无法获知其消耗，不伪造估算。

兼容扩展仅新增 Windows 设置 showAiUsage、项目 aiLastUsage 及删除归档标记。资料格式仍为 schema 1，旧版任务、结果、备份继续读取；没有重写旧题目或原始材料。

## 验证

- `./scripts/build.ps1 -Target test`：TypeScript/Vite、54 项 JavaScript、6 项 Rust 测试通过。
- `node scripts/verify-desktop.mjs`：既有 20 项桌面检查通过。
- `node scripts/verify-worksheet.mjs`：既有 15 项学案检查通过。
- `node scripts/verify-worksheet-fixes.mjs`：新增 7 项检查通过：默认隐藏/设置、32K 请求/截断不重试、累计/增量/缓存、缓存不计费、全局取消及晚到响应、删除重开与历史、950px 浅色布局。模拟后端、独立 localStorage，无付费调用。
- Windows 原生：合成 SQLite 库中从设置开启用量，确认设置实际落库、显示预置 120 / +120 / 输入 100 / 输出 20 / 缓存 40%。这是预置用量显示验证，不是真实 API 计量验证。
- Windows x64 NSIS debug 构建成功；未构建 Android。
- 本轮未再次调用真实模型，未宣称用户的整份材料已重新识别成功，也未验证真实网络长时间响应与服务端取消计费。用户可在更新后点击「重新整理题目」使用新上限；不会自动替用户重发付费请求。

## 截图与复现

运行 `npm run dev`，再执行以上浏览器脚本。测试材料复用 tests/worksheet-fixture.mjs；新增脚本输出位于忽略目录 .local/phase2-fixes。新用量单元测试位于 tests/ai-usage.test.mjs。

- [深色用量栏](assets/phase2-fixes/usage-dark.png)
- [950px 浅色用量栏](assets/phase2-fixes/usage-light-narrow.png)

主要实现：src/model.ts（输出预算）、src/worksheet-ui.ts（删除和取消）、src/main.ts（设置和全局请求统计）、src/ai-usage.mjs（去重汇总）、src/worksheet.css（紧凑显示）、src-tauri/src/lib.rs（Windows 长请求超时）。


## 0.1.7 本机安装补记

Windows 0.1.7 覆盖安装退出码 0，FileVersion / ProductVersion 均为 0.1.7。最终桌面窗口复查因用户按 Esc 停止；已恢复原学习库路径，原 SQLite SHA-256 与安装前一致。后续版本的模式与安装结果见 [0.1.8 记录](WINDOWS_WORKSHEET_MODES.md)。
