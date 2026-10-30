# dsh-plugin-muelsyse-hub

缪尔赛思 · 生态科 主题的左侧栏入口：选开场（A/B/C/D）、选声景（01/02/03）、看重播与运行状态。

- 页面在 `client.js`，走宿主自己的 `sidebar.panellist` / `main` 槽位，不碰 DSH 核心与配置。
- 通过 `window.__muelsyseDeck`（由 `dsh-theme-muelsyse` 发布）驱动主题播放器，写入的只是和主题共用的两个 `localStorage` 键。
- 宿主半边 `index.js` 只提供 `/muelsyse-hub/status` 与 `/muelsyse-hub/ping` 两个探针路由。

## 安装

```powershell
pwsh -File .\install.ps1
```

需要同时装 `dsh-theme-muelsyse`，否则页面会提示「主题播放器未挂载」。
