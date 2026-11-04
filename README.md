# 书友席（Reader Seat）

陪你读名著的虚拟书友评论区。纯客户端 App：Vue 3 + Tauri 2，本地优先，默认 DeepSeek。

产品与技术方案见 [`docs/`](docs/)。

## 开发

```bash
pnpm install
pnpm dev                 # 浏览器
pnpm tauri dev           # 桌面
pnpm tauri android dev   # Android 真机（需 USB 调试）
pnpm test
pnpm lint
```

在设置页填写 DeepSeek API Key 后，可用「测试连接」验证 JSON 与流式调用。密钥只存本地，勿提交 `.env.local`。

## 版本

当前进度：M0 工程脚手架（浏览器 / 桌面已通；Android 真机待验）。
