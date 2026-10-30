# dsh-theme-muelsyse

缪尔赛思 · 生态科 — DeepSeek Harness Web GUI 主题包（开屏动画 · 主界面 · 声景），v0.1.0。

- 四条开屏 `assets/openings/{A,B,C,D}.mp4`：各自带一条声轨 `score-*.m4a`，画与声同长、同时起。默认 **B · 我在听哦**，右下角 ♪ 面板可换，选择记在 `localStorage`。
- 循环背景 `assets/loop.mp4`：取自 p6 干员展示 36.0–39.4s 那束树冠光，裁掉 2.56:1 遮幅正放接倒放，6.8s 无缝；静音、永不拦截交互。
- 三首声景 `assets/bgm/`：01 生态科 PV、02 干员展示（均为 demucs 去人声）、03 Morning Dew（原唱）。按序轮播，♪ 面板可指定起点。
- 深水青生态科配色，令牌级换肤（`theme/theme.css`）。

## 目录

```
lib/index.js         宿主半边：/theme-muelsyse/* 静态路由 + /status 探针
lib/client.js        客户端半边：样式注入、开屏覆盖层、跳过、交接、循环背景、BGM 接力
theme/theme.css      令牌换肤 + 工作栏/工作区布局 + 开屏壳
preview/index.html   独立预览页
tools/smoke.mjs      离线验收
tools/audit-tokens.mjs 令牌名审计
```

## 验证

```bash
node tools/smoke.mjs
node tools/audit-tokens.mjs <dsh-client-bundle.js>
```

smoke 会逐条验收 loop、四条开场与其声轨、三首 BGM 的 200 与 content-type；素材缺失时跳过对应断言，壳与路由照常验收。

## 授权

代码 MIT；视频 / 音频 / 海报素材来自《明日方舟》特别映像 [莱茵生命：访问] 与官方语音集，仅限本地个人使用，公开需重新清权（见 ASSET-LICENSE.md / PROVENANCE.json）。
