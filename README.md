# Muelsyse · 生态科 — DSH 主题运行时包 **v0.1.0**

缪尔赛思主题的**可安装运行时**：DeepSeek Harness Web GUI 的换肤、开屏、声景、左侧控制台、语义语音切片与语气插件，外加一只独立的桌面宠物。

- **整体版本：`v0.1.0`**（见包根 `VERSION`）
- 组件版本：theme `0.1.0` / voice `0.2.0` / persona `0.1.0` / hub `0.1.0` / pet 独立程序（无 `package.json`）
- 载荷体积：**35.06 MiB**（36.76 MB 十进制，未压缩，不含包根 `.git`；含 `.git` 的目录总计 48.50 MiB）
- 平台：Windows + PowerShell 7；DSH `>= 0.2.1-rc.3`
- 这是非官方同人道具，与 Hypergryph / Studio Montagne、DeepSeek 无隶属或背书关系。

> **关于版本号**：包整体标 `v0.1.0`，但语音插件内部仍是 `0.2.0`（`plugins/muelsyse-voice/package.json`）。语音组件在包外单独演进过，把它的 `package.json` 强行降到 `0.1.0` 会造成语义倒退，所以这里保持「**整体 v0.1.0，语音组件内部 0.2.0**」。安装与 patch 都不看版本号，混用不会出问题。

> **素材授权提醒**：代码为 MIT；视频、音频、立绘等素材来自《明日方舟》官方内容，**仅限本地个人使用**。若要公开仓库或分发，请先重新清权，或不要把 `theme/muelsyse/assets/`、`plugins/muelsyse-voice/assets/clips/` 与 `pet/` 里的 exe 推送到公开仓库。详见 `theme/muelsyse/CREDITS.md`、`PROVENANCE.md`、`LICENSE`。

## 1. 包内结构

```text
muelsyse-theme-pack/
├─ VERSION                          v0.1.0
├─ install.ps1                      顶层安装器（复制 + junction + patch + pet）
├─ README.md
├─ theme/
│  └─ muelsyse/                     10.29 MiB
│     ├─ lib/index.js               宿主路由 /theme-muelsyse/*
│     ├─ lib/client.js              换肤、开屏、循环背景、声景、左侧控制台
│     ├─ theme/theme.css            令牌级主题
│     ├─ assets/openings/           A/B/C/D 四张开场 + 各自 score
│     ├─ assets/bgm/                01 生态科 PV / 02 干员展示 / 03 Morning Dew
│     ├─ assets/loop-2k60fps.mp4    循环背景
│     └─ ...
├─ plugins/
│  ├─ muelsyse-voice/               4.10 MiB
│  │  ├─ index.js                   语义语音路由 /muelsyse-voice/*
│  │  ├─ semantic.js                中文意图分类 + 类内 Dice 检索
│  │  ├─ assets/clips/              96 条 .ogg 切片 + refs/ 2 组 48k 参考 wav
│  │  ├─ assets/catalog.json        96 条切片元数据
│  │  ├─ assets/intents.json        5 组 / 29 个意图
│  │  └─ tools/start-sovits.ps1     可选 SoVITS 启动器
│  ├─ muelsyse-persona/             0.01 MiB，语气系统提示段
│  └─ muelsyse-hub/                 0.02 MiB，旧版独立左侧栏（兼容保留）
├─ pet/
│  └─ dsh-pet-standalone-webm-chat.exe   20.61 MiB，独立桌面宠物
└─ tools/
   └─ check-pack.mjs                本包结构 / 素材 / 语法自检
```

包内**不含**：`voicekit`、GPT-SoVITS 模型/权重、备份 `*.bak-*`、`node_modules`、`.git`、`_work`、锁文件、`.dsh-ops-update-*`、`.bak-synth` 之类的中间产物。SoVITS 环境请从网盘获取（见第 5 节）。

## 2. 安装

先让 DSH 至少启动过一次，确保 `%USERPROFILE%\.dsh\profiles\desktop\` 已存在。然后：

```powershell
cd .\muelsyse-theme-pack
pwsh -NoProfile -File .\install.ps1
```

默认安装到当前用户的 `%USERPROFILE%\.dsh`、profile `desktop`，宠物装到 `%APPDATA%\muelsyse-pet`。可用参数：

| 参数 | 作用 |
| --- | --- |
| `-Profile <name>` | 目标 profile，默认 `desktop` |
| `-DshHome <path>` | 另一个 DSH_HOME（例如便携版） |
| `-PetDir <path>` | 宠物安装目录，默认 `%APPDATA%\muelsyse-pet`（也可用环境变量 `MUELSYSE_PET_DIR`） |
| `-Purge` | 先清空四个包目标目录再安装（不删宠物） |
| `-EnableLegacyHub` | 额外启用旧版独立 hub（主题已内置控制台，通常不需要） |
| `-SkipPet` | 不安装桌面宠物 |
| `-NoShortcut` | 装宠物但不建桌面快捷方式 |

```powershell
# 只要主题/语音/语气，忽略宠物
pwsh -NoProfile -File .\install.ps1 -SkipPet

# 装到另一个 DSH_HOME，宠物放 D 盘
pwsh -NoProfile -File .\install.ps1 -DshHome D:\dsh-home -PetDir D:\tools\muelsyse-pet
```

安装器做四件事：

1. 复制 `theme/muelsyse` 与三个插件到 `%DSH_HOME%\themes`、`%DSH_HOME%\plugins`；
2. 在 `profiles\<Profile>\node_modules\` 建立四个 junction：
   - `dsh-theme-muelsyse` → `themes\muelsyse`
   - `dsh-plugin-muelsyse-voice` → `plugins\muelsyse-voice`
   - `dsh-plugin-muelsyse-persona` → `plugins\muelsyse-persona`
   - `dsh-plugin-muelsyse-hub` → `plugins\muelsyse-hub`
3. 向 `profiles\<Profile>\cordis.patch.yml` **幂等**追加 theme / voice / persona 的 `insert` 行；已存在的 id 不会重复追加，只会打印 `already present`；
4. 把 `pet/dsh-pet-standalone-webm-chat.exe` 复制到 `-PetDir`，并（默认）在桌面建 `Muelsyse Pet.lnk`。宠物是独立程序，**不写进** `cordis.patch.yml`。

说明：

- 安装器会先备份 patch 为 `cordis.patch.yml.bak-muelsyse-<时间戳>`，再追加。
- 如果 patch 或 `package.json` 带 UTF-8 BOM，会先剥离并备份（DSH 的严格读取器会把 BOM 当启动错误）。安装器自己写入的内容始终是 UTF-8 无 BOM。
- **请用 `pwsh` 7 运行**。Windows PowerShell 5.1 会把无 BOM 脚本里的中文按 ANSI 解码，写进 patch 的注释会变成乱码（功能不受影响，但很难看）；安装器检测到 5.1 会打印提示。
- 配置层由 HMR 监听；通常无需重启。若界面没有重绘，刷新页面或完整退出 DSH 再打开。
- `muelsyse-hub` 默认只复制、不插入：theme `0.1.0` 的 `lib/client.js` 已经内置左侧控制台，再插 hub 会出现重复入口。只有明确需要旧版独立面板时才加 `-EnableLegacyHub`。

## 3. 功能清单

**主题**

- 深水青 / 生态科配色，令牌级换肤（`theme/theme.css`），不修改 DSH 核心。
- 四张开场 A/B/C/D，各有同长声轨；默认 B，选择写入 `localStorage`。
- 循环背景 `loop-2k60fps.mp4`，静音、不拦截交互。
- 三首声景轮播：01 生态科 PV、02 干员展示、03 Morning Dew；♪ 面板可换曲/静音/调音量。
- 左侧「生态科」控制台：开屏、声景、音量、语音/语气开关、运行状态；由主题自身注册 `sidebar.panellist`，不依赖旧 hub。
- 宿主路由 `/theme-muelsyse/status`、`/theme-muelsyse/report`，便于外部探针确认主题在线。

**语义语音**

- 默认 `/speak`：**本地语义切片**，零 token、零网络、不需要 SoVITS。
- 流程：回复文本分句 → 中文关键词意图分类（5 组 / 29 个意图）→ 意图内 Dice 检索 → 选 1 条切片（`maxClips` 可调到 4）。
- 降级阶梯：命中 → 意图 default → filler → 静默；技术文本（路径、命令、代码、报错）默认不念。
- 96 条切片、2 组 48k 参考音频（`clips/refs/CN_018-48k.wav`、`CN_034-48k.wav`）；`catalog.json` 与 `intents.json` 都是数据驱动，加切片不用改代码。
- 可选旧链路：`POST /speak {"synth": true}` 才走「翻译 → SoVITS」。需要第 5 节的 API key 与环境包；普通使用不需要。
- 控制台「语音服务」开关对应 `POST /muelsyse-voice/enabled`，幂等；`/status` 仍可读。
- 探针：`/muelsyse-voice/status`、`/muelsyse-voice/catalog`、`/muelsyse-voice/intents`。

**语气**

- 向系统提示注册一段可配置的「缪尔赛思」语气；每次模型步重新求值，改开关后下一条回复生效。
- 控制台「语气」开关对应 `POST /muelsyse-persona/enabled`；`GET /muelsyse-persona/status` 可读。
- 会同时作用于子代理/工作流（DSH `systemPrompt` 的现有行为）；技术内容仍要求精确。

## 4. 桌面宠物

`pet/dsh-pet-standalone-webm-chat.exe` 是一个**独立的 Windows 桌面常驻小程序**，和主题包一起分发，但和 DSH 主题/插件是两套东西：不装 DSH 也能跑，装了 DSH 也不影响它。

**是什么**

- 单文件 exe（20.61 MiB），PyInstaller 打成独立程序，内嵌 **PySide6 运行时**，无需另外安装 Python 或 Qt。
- 自带一段 `pet.webm` 动画素材——窗口里循环播放角色动画，旁边带一个可以收起的对话气泡/聊天面板。
- 内含聊天能力（AI provider 设置、本地会话记忆、Markdown 渲染）与 `autostart`（开机自启）相关模块；另有一个 `agent_link.dsh_state` 模块，会去读 DSH 侧的状态喂给宠物。这些都在程序自己的设置里配置，**本包不写任何 `~/.dsh` 配置**。
- 宠物自己的设置、聊天记录、角色包等都落在它自己的运行目录/用户目录里，与主题包无关。

**怎么启动**

```powershell
# 方式一：安装器已复制好的副本
%APPDATA%\muelsyse-pet\dsh-pet-standalone-webm-chat.exe

# 方式二：直接从包里跑，不安装
.\pet\dsh-pet-standalone-webm-chat.exe
```

安装时默认会在桌面放一个 **Muelsyse Pet** 快捷方式；不需要就加 `-NoShortcut`，装完自己建也行。首次启动如果 Windows SmartScreen 拦一下（未签名 exe 的正常提示），选「更多信息 → 仍要运行」。

**素材/依赖说明**

- 动画（`pet.webm`）与角色素材已内嵌在 exe 里，不需要额外的素材目录；换角色靠程序内的角色包功能，不在本包里。
- 不依赖 DSH、不依赖 Node.js、不依赖 Python 环境；除了可选的 AI provider 需要联网与自己的 key，其余离线可用。
- exe 是**未签名二进制**。如果你想自己核对，包里没附带校验文件，可与分发方给的 SHA-256 比对；安装器只做原样复制，不改内容（复制后可用 `Get-FileHash` 复核）。
- 聊天与记忆数据属于程序自身，卸载宠物时如果要彻底清干净，需要自己删它的用户目录（见第 7 节）。

**和语音插件的关系**：没有关系。宠物自己的对话气泡不走 `muelsyse-voice` 的切片，也不影响 `/speak`。两边可以同时开。

## 5. 依赖与可选环境

### 必需

- DeepSeek Harness `>= 0.2.1-rc.3`，Web GUI 可用。
- Windows + PowerShell 7（`pwsh`）。安装器使用 junction 与 UTF-8 无 BOM 写入。
- Node.js 由 DSH 自带运行时提供，无需单独安装。

### 可选：语义语音（默认路径）

不需要额外依赖。只要 `plugins/muelsyse-voice/assets/clips/`、`catalog.json`、`intents.json` 在，`/speak` 就能工作。

### 可选：翻译 + SoVITS（旧链路）

只有显式 `synth: true` 才会用到。环境包（Python + GPT-SoVITS 权重）**不随本包分发**，请从网盘下载：

- **网盘链接**：[夸克网盘](https://pan.quark.cn/s/7331406b7b40?pwd=ycKX)（提取码 ycKX）
- 建议解压到 `%USERPROFILE%\muelsyse-sovits\GPT-SoVITS`，或设置 `MUELSYSE_SOVITS_ROOT`。

翻译 API key 只放在环境变量里，**不要写进 README、patch 或仓库**：

```powershell
# 当前会话
$env:MUELSYSE_TRANSLATE_API_KEY = '<your-key>'

# 或写入用户环境变量（新开终端生效）
[Environment]::SetEnvironmentVariable('MUELSYSE_TRANSLATE_API_KEY', '<your-key>', 'User')
```

常用变量：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `MUELSYSE_TRANSLATE_API_KEY` | 翻译 API key | 空（旧链路不可用） |
| `MUELSYSE_TRANSLATE_API` | 翻译接口地址 | 插件内默认 |
| `MUELSYSE_TRANSLATE_MODEL` | 翻译模型 | 插件内默认 |
| `MUELSYSE_SOVITS_ROOT` | GPT-SoVITS 根目录 | `%USERPROFILE%\muelsyse-sovits\GPT-SoVITS` |
| `MUELSYSE_SOVITS_PYTHON` | 该环境的 Python | `<Root>\runtime\python.exe` 等候选 |
| `MUELSYSE_TTS_API` | SoVITS API 地址 | `http://127.0.0.1:9880` |
| `MUELSYSE_TTS_REF` | 参考音频（必须在插件 `assets/clips/` 内） | `refs/CN_034-48k.wav` |
| `MUELSYSE_TTS_REF_TEXT` | 参考音频文本 | 从 catalog 读取 |
| `MUELSYSE_TTS_SPEED` | 语速 | `1.0` |
| `MUELSYSE_TTS_CACHE` | 合成缓存目录 | 系统临时目录 |
| `MUELSYSE_TTS_LAUNCHER` | 自定义启动脚本 | 插件 `tools/start-sovits.ps1` |

启动 SoVITS（可选）：

```powershell
pwsh -NoProfile -File .\plugins\muelsyse-voice\tools\start-sovits.ps1
# 或指定路径
pwsh -NoProfile -File .\plugins\muelsyse-voice\tools\start-sovits.ps1 -Root D:\muelsyse-sovits\GPT-SoVITS
```

## 6. 自检

### 6.1 包本身自检（不装 DSH 也能跑）

```powershell
# 15 项：版本、JSON、JS 语法、切片、意图、pet、残留文件、体积
node tools\check-pack.mjs

# 需要覆盖全部 .mjs 的 ESM 语法时（不依赖子进程）
node --experimental-vm-modules tools\check-pack.mjs
```

期望结尾是 `all 15 checks passed`。当前快照的基线：`theme 10.29 MiB / voice 4.10 MiB / persona 0.01 MiB / hub 0.02 MiB / pet 20.61 MiB`，载荷 **35.06 MiB**（177 个文件）。

### 6.2 逐个 JS 语法检查

```powershell
Get-ChildItem theme, plugins -Recurse -Include *.js,*.mjs |
  ForEach-Object { node --check $_.FullName }
```

当前快照 24 个 `.js`/`.mjs` 全部通过。

### 6.3 安装后自检（需要真实 DSH_HOME）

```powershell
# 1) patch 中每个 id 只出现一次
$p = "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml"
Select-String -Path $p -Pattern 'theme-muelsyse|muelsyse-voice|muelsyse-persona'

# 2) junction 指向正确
Get-ChildItem "$env:USERPROFILE\.dsh\profiles\desktop\node_modules" |
  Where-Object Name -like '*muelsyse*' |
  Select-Object Name, LinkType, Target

# 3) 宠物就位
Test-Path "$env:APPDATA\muelsyse-pet\dsh-pet-standalone-webm-chat.exe"
```

Web GUI 起来后，把 `<port>` 换成实际端口：

- `http://127.0.0.1:<port>/theme-muelsyse/status`
- `http://127.0.0.1:<port>/muelsyse-voice/status`
- `http://127.0.0.1:<port>/muelsyse-persona/status`

> **为什么不用 `smoke-check.mjs` 直接验这个包？** 那个 harness 期待的是 **dsh-home 布局**（`<home>/themes`、`<home>/plugins`、`<home>/profiles/...`）。本包是**安装源**，根下是 `theme/`（单数）和 `plugins/`，也没有 `profiles/`，所以不能把包根当 `--dsh-home` 传进去。正确用法是**先安装**，再指向真实的 DSH_HOME：
>
> ```powershell
> node C:\path\to\smoke-stage\smoke-check.mjs --dsh-home "$env:USERPROFILE\.dsh"
> ```

## 7. 卸载 / 回滚

安装器没有自动卸载，按下面四步手工回滚：

1. 从 `cordis.patch.yml` 删除 `theme-muelsyse`、`muelsyse-voice`、`muelsyse-persona` 三个 `insert` 行（以及可选的 `muelsyse-hub`）。
2. 删除 `profiles\desktop\node_modules\` 下四个 `dsh-*muelsyse*` junction。
3. 删除 `%DSH_HOME%\themes\muelsyse` 与 `%DSH_HOME%\plugins\muelsyse-{voice,persona,hub}`。
4. 宠物：删掉桌面 `Muelsyse Pet.lnk` 与 `%APPDATA%\muelsyse-pet\`（若改过 `-PetDir`，删对应目录）。聊天记录/角色包在宠物自己的用户目录里，需要的话一并清理。

改动前建议保留 `cordis.patch.yml` 的 `.bak-muelsyse-*` 备份。完整退出 DSH 后再操作更稳妥；卸载宠物前先退出宠物进程（托盘退出）。

## 8. 网盘与素材占位

- SoVITS 环境包：[夸克网盘](https://pan.quark.cn/s/7331406b7b40?pwd=ycKX)（提取码 ycKX）
- 可选语音素材/模型：不随包分发，按需从同一网盘获取
- 素材授权说明：见 `theme/muelsyse/CREDITS.md`、`PROVENANCE.md`、`LICENSE`；公开分发前请重新清权

## 9. 授权

- 代码：MIT（见 `theme/muelsyse/LICENSE`）。
- 主题/语音素材：来自《明日方舟》官方内容，仅限本地个人使用；公开仓库或再分发需自行取得授权。
- 桌面宠物 exe 为随包分发的独立二进制，同样仅限本地个人使用；其中的角色素材授权同上。
- 本项目为非官方同人作品，不代表 Hypergryph / Studio Montagne / DeepSeek。
