# 书友席（Reader Seat）

陪你读名著的虚拟书友评论区。纯客户端 App：Vue 3 + Tauri 2，本地优先，无后端；默认 DeepSeek（OpenAI 兼容接口可配）。目标平台：Android（主）、macOS、Windows。

## 功能概览

- 导入 EPUB，本地阅读与进度恢复
- 读到哪里、段评生成到哪里（粗生成 / 精修 / 实时接话）
- 常驻书友与路人、楼中楼互动、书圈记忆
- 防剧透档位、评论反馈与成本统计
- 本章说、先写后看、划线批注、Markdown / JSON 备份

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3、TypeScript、Vite、Pinia、Vue Router、Vant 4、Less |
| 外壳 | Tauri 2（plugin-http / fs / dialog / store / os） |
| 数据 | Dexie（IndexedDB）、zod；书籍原文件存 App 数据目录 |

## 快速开始

```bash
pnpm install
pnpm dev                 # 浏览器 → http://localhost:1420
```

在设置页填写 API Key 后，可用「测试连接」验证 JSON 与流式调用。密钥只存本地，勿提交 `.env.local`。

桌面、Android 真机、工具链与 Release 打包见 [`docs/开发文档.md`](docs/开发文档.md)。

## 常用命令

```bash
pnpm dev                 # 浏览器开发
pnpm tauri dev           # 桌面开发
pnpm tauri android dev   # Android 真机（需 USB 调试）
pnpm test                # 单元测试
pnpm lint                # ESLint
pnpm build               # 前端生产构建
pnpm tauri build         # 当前桌面平台安装包
pnpm tauri android build --apk   # Android APK
```

## 文档

| 文档 | 说明 |
| --- | --- |
| [开发文档](docs/开发文档.md) | 环境搭建、调试启动、Release 打包 |
| [产品设计_V2](docs/产品设计_V2.md) | 产品定位与验收标准 |
| [技术方案与实现计划](docs/技术方案与实现计划.md) | 架构、任务编号与进度 |

## 版本与进度

当前版本 **0.1.0**。M1～M5 功能已落地，完成 UI/UX 精修；阶段 0 原型已移除。正式三端签名分发、桌面文件关联、屏幕常亮等仍有遗留，详见技术方案第 10 节。
