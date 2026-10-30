# 素材来源与权利说明 · dsh-theme-muelsyse v0.1.0

代码（`lib/`、`theme/theme.css`、`tools/`、安装脚本等）为 MIT，见 `LICENSE`。

下列视频与音频**不属于 MIT**，权利归原权利人；本包只做本地个人使用，公开分发前需自行清权。

## 画面

| 文件 | 来源 | 处理 |
| --- | --- | --- |
| `assets/loop.mp4` | B 站 [BV1Zs4y1c7td](https://www.bilibili.com/video/BV1Zs4y1c7td/) p6「干员展示」36.0–39.4s | 裁掉 2.56:1 上下遮幅 → 放大铺满 16:9 → 正放接倒放，6.8s 无缝 |
| `assets/openings/A.mp4` | 同上 p3 前瞻 PV 0.6–7.6s | 裁 16:9、调色、加 HUD 与标题 |
| `assets/openings/B.mp4` | 同上 p3 8.0–17.0s | 同上 |
| `assets/openings/C.mp4` | 同上 p3 16.5–26.5s | 同上 |
| `assets/openings/D.mp4` | 同上 p3 0.0–9.5s | 同上，底乐与顿点按两次光脉冲塑形 |

## 声音

| 文件 | 来源 | 处理 |
| --- | --- | --- |
| `assets/openings/score-*.m4a` | 她的中文语音切片（`muelsyse/.assets-src/voice/v1/07-release/clips`）+ Kevin MacLeod *Dark Fog* | 人声对齐画面切点；*Dark Fog* 为 CC BY 4.0，见 `CREDITS.md` |
| `assets/bgm/01-eco-pv.m4a` | p3 前瞻 PV 音轨 | demucs `htdemucs` 去人声 → 只留 no_vocals → loudnorm -18 LUFS → AAC 160k |
| `assets/bgm/02-eco-showcase.m4a` | p6 干员展示音轨 | 同上 |
| `assets/bgm/03-morning-dew.m4a` | B 站 [BV14X4y1U7iR](https://www.bilibili.com/video/BV14X4y1U7iR/)《明日方舟》EP - Morning Dew | 保留原唱，仅 loudnorm + AAC 160k |

## 说明

- 人声分离用 demucs 4.1.0 `htdemucs`（MIT），权重在本地缓存，不随包分发。
- 语音切片来自官方语音集，权利归原权利人；本包只做播放与混音，不再授权。
- 上述素材仅限本地个人安装使用。公开上传、镜像、打包下载或商业使用前，请先取得相关权利人的许可。
