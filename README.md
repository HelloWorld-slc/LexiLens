# LexiLens

本机英语精读与语境词句本，面向 Windows 和 Android，MIT 许可证。

**当前是开发中的 0.1.0，尚未完成两端首版验收。** Windows 已编译生成测试安装包；Android 与设备验收进度见 [验证记录](docs/VALIDATION.md)。请使用独立测试目录。

导入 JPG / PNG，逐页转写与核对，点击单词或拖选短语获取语境解释。收藏保留原词形、原句和出处；项目词句本与全局词句本共享记录。阅读、已有释义和词句复习可离线使用，新识别和解释需要个人 DeepSeek Key。

已接入的代码包含原图与处理副本、正文版本、单篇总结、多段分析、自由追问、可取消请求、固定批次词句复习、回收站、手动备份及导出。代码存在不代表已在每个平台通过验收，详细边界见验证记录。

## 数据保存

- Windows：所选资料目录包含 SQLite 工作库和 `assets` 原图副本。
- Android：系统选定的本机目录包含原图与备份；SQLite 在应用私有目录。卸载前必须导出完整备份。
- Key：Windows 使用当前用户 DPAPI，Android 使用 Keystore；不放入资料库、普通备份和日志。
- 网络：模型请求由原生代码发送至 DeepSeek 官方 HTTPS 接口。默认 Flash；Pro 由用户主动选择用于文本任务。OCR 始终使用 Flash，无自动模型升级。
- 无登录、云保存、自动同步、遥测、PDF 导入或自动答题。问题需要用户核对后主动请求解答。思维导图不在本期。

完整备份包含正文、版本、收藏、模型结果和引用到的图像；轻量备份不含图像。导入使用新资料 ID，原库不覆盖。当前单包上限 128 MiB，较大资料可分项目导出。模型可能转写错误，核对原图后再使用。

## 开发与构建

需要 Node.js、Rust stable。Windows 还需要 MSVC C++ 构建工具、Windows SDK、WebView2；Android 需要 JDK 21、SDK 36、NDK 29 和相应 Rust targets。依赖版本由锁文件固定。

```powershell
npm ci
npm test
npm run build
./scripts/build.ps1 -Target test
./scripts/build.ps1 -Target windows
./scripts/build.ps1 -Target android
```

脚本默认生成 debug 测试包；Windows 可增加 `-Release`。Android release 还需要配置自己的签名，签名文件不可提交。脚本优先使用本地 `.tools` 工具链，也支持已配置的系统工具链。首次 Android 构建自动生成工程并关闭 Android 自动备份。

`npm run dev` 只检查网页布局；浏览器模式不会假装拥有原生保存或模型能力。原生开发使用 `npm run tauri -- dev`。Windows 测试包位于 `src-tauri/target/debug/bundle/nsis/`，Android 输出位于生成工程的 `app/build/outputs/apk/`。

## 源码

- `src/core.mjs`：版本引用、词句收藏、复习、取消状态和备份副本映射。
- `src/main.ts`：共享响应式界面与任务流程。
- `src-tauri/src/`：SQLite、资产、官方模型接口、备份、DPAPI 和 Windows 语音。
- `plugins/tauri-plugin-platform/`：Android 本机目录、Keystore、语音与相机。
- `tests/`：可重复的逻辑验证，不携带私人学习材料或凭据。

项目许可证见 [LICENSE](LICENSE)，依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。用户测试图片、需求问卷、数据库、原始 API 响应和本地配置不属于公开源码。
