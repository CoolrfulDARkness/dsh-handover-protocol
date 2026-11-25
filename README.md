# dsh-handover-protocol

会话头部的标准化交接手续开关按钮 · A per-session handover-protocol toggle button for the DeepSeek Harness (DSH) session header.

## 这是什么

在每个会话头部 utilities 槽放一个 28px 的「交接」按钮（与宿主图标按钮同风格：圆形、
主题令牌配色，暗色/亮色模式自动适配）：

- **默认暗色**：不注入任何内容，一次性任务会话零打扰。
- **点亮后**：该会话的系统提示注入交接协议指针 + 全套触发词手续
  （"准备交接" → 移交方两层移交包；"你来接手" → 接管方分级自判 + 机械验证，fail-closed）。
- **按 sessionId 记忆**：开关状态存在宿主侧，重载后保持；会话之间互不影响。
- **模型可自查**：点亮会话内模型可调用 `handover_status` 工具确认当前状态。
- **新会话自动点亮**：在空白新对话顶栏（右侧栏展开按钮左侧）有一颗备用开关，
  点亮后所有**未显式关闭**的会话自动启用交接协议——不必逐个会话点。
  单个会话点灭即显式关闭，优先于自动点亮。
  （空白会话没有 sessionId，宿主也不渲染会话头部按钮，所以这颗开关挂在常驻的
  顶层悬浮位，仅在新对话可见，非空白会话自动让位。）

## 为什么需要它

多智能体协作里"交接"是最容易丢东西的环节：产物没记 SHA、未验项没登记、
接管方自以为接住了。本插件把标准化交接手续做成**每个会话可选的开头注入**——
只在需要交接工作的会话生效，其余会话完全无感。

## 安装

在 DSH 插件市场安装，或手动安装：

```sh
# 在 profile 的 node_modules 下建立 junction（Windows；macOS/Linux 用 ln -s）
mklink /J "C:\Users\<you>\.dsh\profiles\desktop\node_modules\dsh-handover-protocol" "<本仓库克隆路径>"
```

然后在 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: handover-protocol
      name: dsh-handover-protocol
```

## 配置

协议全文默认使用插件自带的中文版 `protocol/HANDOVER-PROTOCOL.md`。
想换英文版，加 `protocolLang`：

```yaml
- insert:
    - id: handover-protocol
      name: dsh-handover-protocol
      config:
        protocolLang: 'en'   # 使用 protocol/HANDOVER-PROTOCOL.en.md
```

想换成自己的协议文件，用 `protocolPath`（优先级高于 `protocolLang`）：

```yaml
- insert:
    - id: handover-protocol
      name: dsh-handover-protocol
      config:
        protocolPath: 'C:\\path\\to\\your\\HANDOVER-PROTOCOL.md'
```

注意 `protocolPath` 必须用**绝对路径**——各会话 cwd 不同，相对路径会指错文件。

## 宿主兼容

`engines.dsh` 声明支持 DSH `>=0.2.1-rc.5 <0.4.0-0`；实测宿主版本为 `0.2.2-rc.1`
（`@deepseek-ai/dsh-desktop-runtime`）。本地 smoke 覆盖状态往返、按 sessionId 隔离、
degraded/fail-closed、sessionId 白名单、autoArm 与 API 400/405/413/403 路径：

```sh
npm test
```

## 设计要点

- 所有宿主 API 形状对齐 resource-lease / better-sidebar 等已验证实现，
  hook 回调一律 try/catch：插件错误绝不中断会话创建。
- 状态文件损坏自动进入 **degraded 态**：fail-closed（视为全关）且全线可见
  （按钮变红、API 响应带 `degraded` 标志、注入回调输出警告行）。
- sessionId 白名单校验（`[A-Za-z0-9_-]{1,128}`，显式拒原型危险 key）；
  `_autoArm` 为保留键（仅自动点亮开关可写）。
- 开关三态：显式开 > 显式关 > 继承"新会话自动点亮"。
- HTTP 路由走宿主标准 fence 准入（loopback / Origin / sec-fetch-site），fail-closed。
- 同一会话的点击串行化，消除双击竞态。
- 按钮外观全部使用宿主主题令牌（`--dsw-alias-*`），暗色/亮色模式与原生按钮一致。

## 隐私与数据

唯一持久化数据是插件目录下的 `session-state.json`：`{ "<sessionId>": true }`，
只记录哪些会话开了开关，不含任何会话内容。

## 语言 / Language

触发词**不是代码级关键字匹配**，而是注入到系统提示的映射表，由模型语义匹配。
映射同时列出中英文触发词（"准备交接" / "prepare handover" 等同义表述均可触发）。
协议全文自带双语两份：`protocol/HANDOVER-PROTOCOL.md`（中文，默认）与
`protocol/HANDOVER-PROTOCOL.en.md`（英文），用 `config.protocolLang: 'en'` 切换，
或用 `config.protocolPath` 指定自己的文件。

Trigger words are NOT code-level keyword matching — they are a mapping table
injected into the system prompt, matched semantically by the model. Both Chinese
and English triggers are listed. The bundled protocol ships in two languages:
`protocol/HANDOVER-PROTOCOL.md` (Chinese, default) and
`protocol/HANDOVER-PROTOCOL.en.md` (English) — select with `config.protocolLang: 'en'`,
or point `config.protocolPath` at your own file.

## License

MIT
