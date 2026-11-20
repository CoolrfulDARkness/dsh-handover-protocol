/**
 * dsh-handover-protocol — 按钮式按需激活的会话交接协议。
 *
 * 设计：
 * - 每个会话头部有一个按钮（客户端 lib/client.js 注册）。默认暗色、协议不注入。
 * - 点击按钮 → POST /handover/api/toggle {sessionId, on} → 后端记住该会话的开关。
 * - 只有开关为 on 的会话，才在 systemPrompt 注入全套协议全文指针。
 * - 按钮亮起时，同时注册一个 handover_status 工具供模型自查状态。
 *
 * 宿主 API 形状全部对齐 resource-lease / guizang-design 的可用实现：
 * - agent/created 的 payload 是 { agent }，不是 agent 本身。
 * - tools 是宿主 service（ctx.tools.register），不是 agent.ctx.tools。
 * - defineTool 形状要求 output 同时有 schema 和 render。
 * - systemPrompt.context 用 { name, order, text }（text 可为函数，异常必须自行吞掉）。
 * - 所有 hook 回调一律 try/catch：插件的错误绝不能中断 agent 创建（那会让会话打不开）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-handover-protocol'
export const inject = ['systemPrompt', 'tools', 'webServer', 'connection']

const PLUGIN_ROOT = fileURLToPath(new URL('.', import.meta.url))
// 插件自带的默认协议全文（zh/en 两份，protocolLang 选择）；用户可通过 config.protocolPath 覆盖。
const DEFAULT_PROTOCOLS = {
  zh: path.join(PLUGIN_ROOT, 'protocol', 'HANDOVER-PROTOCOL.md'),
  en: path.join(PLUGIN_ROOT, 'protocol', 'HANDOVER-PROTOCOL.en.md'),
}
const STATE_FILE = path.join(PLUGIN_ROOT, 'session-state.json')
const API_BASE = '/handover/api'
const CONTEXT_NAME = 'handover-protocol'

const logger = {
  warn: (...a) => { try { console.warn('[dsh-handover-protocol]', ...a) } catch {} },
}

// ---- 状态存储（按 sessionId） -------------------------------------------
// degraded：状态文件存在但不可解析。此时所有开关一律视为关（fail-closed），
// 但必须让调用方看得见——API 响应带 degraded 标志，注入回调输出可见警告。
function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { state: {}, degraded: false }
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { state: parsed, degraded: false }
    }
    logger.warn('状态文件内容不是对象，进入 degraded 态:', STATE_FILE)
    return { state: {}, degraded: true }
  } catch (e) {
    logger.warn('读取状态失败，按空状态继续（degraded）:', e instanceof Error ? e.message : e)
    return { state: {}, degraded: true }
  }
}

function writeState(state) {
  // 随机后缀避免与编辑器/杀软占用固定 .tmp 冲突；Windows rename 失败重试一次。
  const tmp = STATE_FILE + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2)
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  try {
    fs.renameSync(tmp, STATE_FILE)
  } catch (e) {
    try { fs.copyFileSync(tmp, STATE_FILE); fs.unlinkSync(tmp) } catch (e2) {
      try { fs.unlinkSync(tmp) } catch {}
      throw e
    }
  }
}

/**
 * 取会话 id。权威来源：agent.session.id（与工具运行时的 exec.agent.session.id 一致），
 * 回退到 agent.id。宿主构造性不变式（dsh-agent/lib/index.js:643）保证 agent.id === agent.session.id。
 * 依据：resource-lease 的 agentKey()。
 */
function sessionIdOf(agent) {
  if (!agent || typeof agent !== 'object') return undefined
  const session = agent.session
  const id = session && typeof session === 'object' ? session.id : undefined
  if (typeof id === 'string' && id !== '') return id
  const flat = agent.id
  return typeof flat === 'string' && flat !== '' ? flat : undefined
}

function cwdOf(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

function isOn(sessionId) {
  if (!sessionId) return false
  try { return readState().state[sessionId] === true } catch { return false }
}

// sessionId 白名单：字母/数字/下划线/连字符，≤128。客户端实际用 "session-<uuid>"，
// 该正则同时挡掉 1MB 超长 key 与 __proto__/constructor 等原型危险 key。
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
function validSessionId(s) {
  if (typeof s !== 'string' || !SESSION_ID_RE.test(s)) return false
  return s !== '__proto__' && s !== 'constructor' && s !== 'prototype'
}

function setOn(sessionId, on) {
  if (!validSessionId(sessionId)) return false
  try {
    const r = readState()
    // degraded 态禁止写盘：r.state 是替身空对象，直接写入会覆盖损坏文件、
    // 销毁其他会话的开关状态。返回 false → toggle 500 → 客户端显示错误态。
    if (r.degraded) return false
    const s = r.state
    if (on) s[sessionId] = true
    else delete s[sessionId]
    writeState(s)
    return true
  } catch (e) {
    logger.warn('写入状态失败:', e instanceof Error ? e.message : e)
    return false
  }
}

// ---- 协议文本 -------------------------------------------------------------
function protocolState(protocolPath, cwd) {
  try {
    const abs = path.isAbsolute(protocolPath) ? protocolPath : path.join(cwd || process.cwd(), protocolPath)
    if (!fs.existsSync(abs)) return { ok: false, text: `协议文件不可读：${abs}` }
    const size = fs.statSync(abs).size
    return { ok: true, abs, size }
  } catch (e) {
    return { ok: false, text: `协议文件不可读：${e instanceof Error ? e.message : e}` }
  }
}

function enabledText(protocolPath, state) {
  const lines = ['### 标准化交接手续 —— 已启用（本会话）']
  if (state.ok) {
    lines.push(`协议全文：${state.abs}（${Math.round(state.size / 1024)} KB，在盘）。收到交接触发词时立即读取全文并执行。`)
  } else {
    lines.push(`协议全文当前不可读：${state.text}。收到交接触发词时，按下列最小手续执行（交接包必含项完整清单见协议 §四，共 11 项；以下仅最小集）：`)
    lines.push('- "准备交接/交接/收尾" → 移交方：产出交接包最小集（横幅与作废清单、产物谱系 SHA、未验项、授权与回滚、外部承诺、组织形式登记、定稿 SHA），台账追加移交记录；最小集不满足 11 项判据，必须在交接包中明确标注缺口。')
    lines.push('- "你来接手/接手/接管" → 接管方：先分级自判（复述横幅/作废清单/谱系，答不全按冷交接），再做 7 项机械验证并留原始输出，宣布"已接住/缺口 X"后才开工。')
    lines.push('- 日常纪律：产物随产随归档记 SHA；文档只追加不重写；每轮更新运行态登记。')
  }
  lines.push('- 触发词映射（模型语义匹配，不限于字面）："准备交接/交接/收尾/我要下线了" 或 "prepare handover / handover / wrap up / I\'m going offline" → 移交手续；"你来接手/接手/接管/继续前任的工作" 或 "you take over / take over / continue your predecessor\'s work" → 接管手续。')
  lines.push('- 本提示随会话开关出现；用户点暗按钮即关闭，关闭后不再注入本协议。')
  return lines.join('\n')
}

function degradedText() {
  return [
    '### 标准化交接手续 —— ⚠ 状态不可读（degraded）',
    'session-state.json 无法解析，本会话的交接开关已停用（fail-closed）。',
    '收到交接触发词时：不要静默继续，先告知用户检查插件目录下的 session-state.json。',
  ].join('\n')
}

// ---- 工具定义（output 必须有 schema + render） ----------------------------
const textRender = (fn) => (args, value) => [{ type: 'text', text: fn(value, args) }]

/**
 * 与权威 defineTool 的编译结果对齐：parameters 必须带 type:'object'，
 * output.schema 必须声明 properties，否则 registry 的 assertSupportedJsonSchema
 * 会拒绝注册（且被外层 catch 吞掉，工具静默消失）。
 */
function defineTool(spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: spec.output.schema ?? {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          enabled: { type: 'boolean' },
          sessionId: { type: 'string' },
        },
        required: ['ok', 'enabled'],
        additionalProperties: false,
      },
      render: spec.output.render,
    },
    execute: spec.execute,
  }
}

// ---- 插件主体 -------------------------------------------------------------
export function apply(ctx, config = {}) {
  // 协议语言选择：config.protocolLang = 'zh'（默认）| 'en'（选 protocol/HANDOVER-PROTOCOL.en.md）。
  // config.protocolPath 显式指定时优先于语言选择。
  const lang = config.protocolLang === 'en' ? 'en' : 'zh'
  const protocolPath = typeof config.protocolPath === 'string' && config.protocolPath.trim() !== ''
    ? config.protocolPath
    : DEFAULT_PROTOCOLS[lang]
  // 协议文件缺失只 warn 一次（启动时），避免静默进入降级文本而无人知晓。
  try {
    const abs = path.isAbsolute(protocolPath) ? protocolPath : path.join(process.cwd(), protocolPath)
    if (!fs.existsSync(abs)) logger.warn('protocolPath 指向的协议文件不存在，注入将走降级文本:', abs)
  } catch {}
  const disposers = []

  // 会话级协议注入：仅当该会话按钮点亮时生效。text 回调必须自身防御。
  try {
    const d = ctx.effect(() => ctx.systemPrompt.context({
      name: CONTEXT_NAME,
      order: 300,
      text: (assembly) => {
        try {
          // resource-lease 的 agentKey() 同时接受 agent 与 assembly.scope 两种形状。
          // 必须回退 scope，否则标准 assembly 下取不到 sessionId，按钮亮也不注入。
          const agent = assembly?.agent ?? assembly?.scope ?? assembly
          const r = readState()
          // degraded：让模型看得见，而不是静默空串。
          if (r.degraded) return degradedText()
          if (!(r.state[sessionIdOf(agent)] === true)) return ''
          return enabledText(protocolPath, protocolState(protocolPath, cwdOf(agent)))
        } catch (e) {
          logger.warn('注入协议上下文失败，降级为不注入:', e instanceof Error ? e.message : e)
          return ''
        }
      },
    }), 'dsh-handover-protocol: 按需协议注入')
    if (typeof d === 'function') disposers.push(d)
  } catch (e) {
    logger.warn('注册 systemPrompt.context 失败:', e instanceof Error ? e.message : e)
  }

  // 工具：模型自查当前会话是否已启用交接协议。
  try {
    const d = ctx.effect(() => ctx.tools.register(defineTool({
      name: 'handover_status',
      description: '查询当前会话是否已启用标准化交接手续（由用户在会话头部的按钮控制）。启用后，收到交接触发词才读取协议全文并执行手续。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            enabled: { type: 'boolean' },
            degraded: { type: 'boolean' },
            sessionId: { type: 'string' },
          },
          required: ['ok', 'enabled', 'degraded'],
          additionalProperties: false,
        },
        render: textRender((v) => v?.enabled
          ? '本会话已启用标准化交接手续。收到交接触发词时读取协议全文并执行。'
          : v?.degraded
            ? '⚠ 标准化交接手续状态不可读（session-state.json 异常）。请告知用户检查插件目录下的 session-state.json。'
            : '本会话未启用标准化交接手续。用户可在会话头部点击「交接」按钮启用。'),
      },
      async execute(args, exec) {
        const sessionId = sessionIdOf(exec?.agent ?? exec?.scope ?? exec)
        const r = readState()
        return { ok: true, enabled: r.state[sessionId] === true, degraded: r.degraded, sessionId: sessionId ?? '' }
      },
    })), 'dsh-handover-protocol: handover_status 工具')
    if (typeof d === 'function') disposers.push(d)
  } catch (e) {
    logger.warn('注册工具失败:', e instanceof Error ? e.message : e)
  }

  // HTTP 路由：客户端按钮读写开关状态。只接受 POST，字段严格校验。
  try {
    const d = ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: API_BASE,
      handler: async (req, res) => {
        // 与宿主全部 /sidebar 路由一致：先做准入检查。
        // fail-closed：connection 服务存在但 requestRejection 缺失（版本漂移）时一律拒绝，
        // 绝不把"检查不到"当成"检查通过"。
        const fence = (r) => {
          if (typeof ctx.connection?.requestRejection !== 'function') return false
          return ctx.connection.requestRejection(r) === undefined
        }
        const send = (status, body) => {
          try {
            if (res.headersSent === true) { res.destroy?.(); return }
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify(body))
          } catch {}
        }
        try {
          if (!fence(req)) { send(403, { ok: false, error: 'forbidden' }); return }
          if (req.method !== 'POST') { send(405, { ok: false, error: 'method not allowed' }); return }
          const u = new URL(req.url || '/', 'http://dsh.internal')
          const method = u.pathname.startsWith(API_BASE + '/') ? u.pathname.slice(API_BASE.length + 1) : ''
          if (method !== 'toggle' && method !== 'state') { send(404, { ok: false, error: 'unknown method' }); return }
          // Buffer 累积 + 1MB 上限，避免跨 chunk 多字节乱码与无界读取。
          const chunks = []
          let total = 0
          for await (const chunk of req) {
            const buf = Buffer.from(chunk)
            total += buf.length
            if (total > (1 << 20)) { send(413, { ok: false, error: 'body too large' }); return }
            chunks.push(buf)
          }
          const text = Buffer.concat(chunks).toString('utf8')
          let payload = {}
          try { payload = text.trim() === '' ? {} : JSON.parse(text) } catch { send(400, { ok: false, error: 'bad json' }); return }
          const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
          if (!validSessionId(sessionId)) { send(400, { ok: false, error: 'invalid sessionId' }); return }
          if (method === 'state') {
            const r = readState()
            send(200, { ok: true, enabled: r.state[sessionId] === true, degraded: r.degraded, sessionId })
            return
          }
          // on 必须是 boolean（缺省视为 off 是旧语义；类型错误现在显式拒绝，避免 200 误报）。
          if (payload.on !== undefined && typeof payload.on !== 'boolean') { send(400, { ok: false, error: 'on must be boolean' }); return }
          const on = payload.on === true
          const saved = setOn(sessionId, on)
          const after = readState()
          const okRsp = saved && !after.degraded
          send(okRsp ? 200 : 500, { ok: okRsp, enabled: after.state[sessionId] === true, degraded: after.degraded, sessionId })
        } catch (e) {
          logger.warn('API 处理失败:', e instanceof Error ? e.message : e)
          send(500, { ok: false, error: 'internal error' })
        }
      },
    }), 'dsh-handover-protocol: /handover/api 路由')
    if (typeof d === 'function') disposers.push(d)
  } catch (e) {
    logger.warn('注册路由失败:', e instanceof Error ? e.message : e)
  }

  return () => { for (const d of disposers) { try { d() } catch {} } }
}
