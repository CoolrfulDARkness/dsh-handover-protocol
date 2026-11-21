// dsh-handover-protocol — 浏览器半边（纯 JS，无需 TS 构建）。
//
// 在每个会话头部的 utilities 槽注册一个「交接」按钮：
//   - 默认暗色（未启用），点击后点亮并通知 Host 记住该会话的开关；
//   - 再点一次熄灭。状态按 sessionId 存于 Host，重载后仍保持。
// 按钮只做状态切换，协议文本由 Host 侧注入，浏览器不碰提示词。

window.__ModuleLoader__.load({
  id: 'dsh-handover-protocol',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var ReactDOM = require('react-dom')
    var h = React.createElement
    var SLOT = 'conversation.session.header.utilities'
    var OVERLAY_SLOT = 'shell.overlay'
    var ID = 'dsh-handover-protocol:toggle'
    var AUTOARM_ID = 'dsh-handover-protocol:autoarm'
    var BTN = 28
    var GAP = 8

    // 与宿主/better-sidebar 同一套设计令牌：暗色模式下圆形、透明底、hover 反色、
    // active 用 business-primary，degraded 用 error-primary——不再是突兀的硬编码蓝块。
    var STYLE_TAG = 'dsh-handover-protocol/button.css'
    var STYLE_CSS = [
      '.dsh-handover-toggle,.dsh-handover-autoarm{width:28px;height:28px;padding:0;border:none;border-radius:50%;',
      'background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;',
      'align-items:center;justify-content:center;flex:none;',
      'transition:background var(--ds-transition-duration-slow) var(--ds-ease-in-out),color var(--ds-transition-duration-slow) var(--ds-ease-in-out)}',
      '.dsh-handover-toggle:hover:not(:disabled),.dsh-handover-autoarm:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsh-handover-toggle[data-active],.dsh-handover-autoarm[data-active]{color:var(--dsw-alias-state-business-primary)}',
      '.dsh-handover-toggle[data-degraded],.dsh-handover-autoarm[data-degraded]{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-handover-toggle:focus-visible,.dsh-handover-autoarm:focus-visible{outline:2px solid var(--dsw-alias-interactive-bg-hover-accent);outline-offset:-1px}',
    ].join('')
    function injectStyles() {
      try {
        if (document.querySelector('style[data-plugin-css="' + STYLE_TAG + '"]') !== null) return
        var tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-handover-protocol'
        tag.dataset.pluginCss = STYLE_TAG
        tag.textContent = STYLE_CSS
        document.head.appendChild(tag)
      } catch (e) { /* 样式失败不阻断功能 */ }
    }

    // 相对 document.baseURI 解析，兼容桌面壳 dsh-app://app/ 与反向代理前缀。
    function apiUrl(method) {
      // 去掉 leading slash：桌面壳 dsh-app://app/ 与反代前缀下都必须用相对路径。
      var rel = 'handover/api/' + method
      try { return new URL(rel, document.baseURI).href }
      catch (e) { return rel }
    }

    var cache = Object.create(null)
    var degradedCache = Object.create(null) // 服务端状态文件不可读时置 true，按钮显示错误态
    var inflight = Object.create(null) // 每个 sessionId 串行化写请求，消除双击竞态

    function request(method, body) {
      return fetch(apiUrl(method), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
    }

    function read(sessionId) {
      return request('state', { sessionId: sessionId }).then(function (j) {
        var on = !!(j && j.ok && j.enabled)
        var degraded = !!(j && j.degraded)
        cache[sessionId] = on
        degradedCache[sessionId] = degraded
        return { on: on, degraded: degraded }
      }).catch(function () {
        // 读取失败不污染 cache，保留当前显示
        return {
          on: cache[sessionId] === undefined ? false : cache[sessionId],
          degraded: degradedCache[sessionId] === undefined ? false : degradedCache[sessionId],
        }
      })
    }

    // 串行化：同一 sessionId 的点击排队，后一次基于前一次的服务端结果。
    function write(sessionId, on) {
      var prev = inflight[sessionId] || Promise.resolve()
      var next = prev.catch(function () {}).then(function () {
        return request('toggle', { sessionId: sessionId, on: on }).then(function (j) {
          if (!j || j.ok !== true) throw new Error('toggle rejected')
          if (j.degraded) throw new Error('state degraded')
          var actual = typeof j.enabled === 'boolean' ? j.enabled : on
          cache[sessionId] = actual
          degradedCache[sessionId] = false
          return { ok: true, value: actual, degraded: false, autoArm: j.autoArm === true }
        })
      })
      inflight[sessionId] = next.catch(function () {})
      return next
    }

    // ---- 新会话自动点亮（blank 会话备用入口）--------------------------------
    var autoArmCache = false
    var autoArmErr = false

    function readAutoArm() {
      return request('autoArm', {}).then(function (j) {
        autoArmCache = j && j.autoArm === true
        autoArmErr = false
        return autoArmCache
      }).catch(function () {
        // 宿主未重启（旧版本无 autoArm 路由）等场景：按钮可见但点击会报错态
        return autoArmCache
      })
    }

    function writeAutoArm(on) {
      return request('autoArm', { on: on }).then(function (j) {
        if (!j || j.ok !== true) throw new Error('autoArm rejected')
        if (j.degraded) throw new Error('state degraded')
        autoArmCache = j.autoArm === true
        autoArmErr = false
        return autoArmCache
      })
    }

    // 对齐逻辑与 better-sidebar DockFallback 同源：锚定宿主右侧栏展开按钮，
    // 若其备用入口在场则排在其左侧；右侧栏展开态（面板内 Collapse 按钮可见）
    // 不悬浮——此时 ExpandButton 已 return null，唯一可见锚点在面板内部，悬浮会
    // 与面板控件簇重叠（复审 N3）。
    // 判定必须用**可见性**（rect 与视口相交），不能用"在 DOM"：
    // 收起态的 Collapse 按钮（[data-sidebar-right-toggle]）仍留在 DOM 但 offscreen
    // （实测 left 2286 / viewport 1600），按 DOM 存在判定会把收起态误杀成
    // "展开态"导致按钮永不出现（2026-11-21 无头实测踩坑，v1.3.1 修正）。
    function visible(el) {
      if (!el || !el.getBoundingClientRect) return false
      var r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return false
      return r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0
    }
    function measureAutoArm() {
      if (visible(document.querySelector('[data-sidebar-right-toggle]'))) return null
      var dock = document.querySelector('[data-dsh-dock-fallback]')
      var expand = document.querySelector('[data-sidebar-right-expand]')
      var anchor = null
      if (visible(dock)) anchor = dock.getBoundingClientRect()
      if (!anchor && visible(expand)) anchor = expand.getBoundingClientRect()
      if (!anchor) return null
      var top = Math.max(4, anchor.top + (anchor.height - BTN) / 2)
      // 左下限 4px（复审 N1）：锚点已退到屏幕左缘时不再出屏。
      var left = Math.max(4, anchor.left - GAP - BTN)
      return { top: Math.round(top), left: Math.round(left) }
    }

    function HandoverAutoArm() {
      var st = React.useState(autoArmCache)
      var on = st[0]
      var setOn2 = st[1]
      var posState = React.useState(null)
      var pos = posState[0]
      var setPos = posState[1]
      var busyRef = React.useRef(false)

      React.useEffect(function () {
        readAutoArm().then(function (v) { setOn2(v) })
        var alive = true
        function tick() {
          if (!alive || document.hidden) return
          // 会话头部的正式入口在场（非 blank 会话）⇒ 备用入口让位
          if (document.querySelector('[data-dsh-handover-toggle]')) { setPos(null); return }
          // 相等短路（复审 N6）：位置没变不触发 re-render。
          setPos(function (prev) {
            var next = measureAutoArm()
            if (prev === null && next === null) return prev
            if (prev !== null && next !== null && prev.top === next.top && prev.left === next.left) return prev
            return next
          })
        }
        tick()
        var timer = setInterval(tick, 500)
        var onResize = function () { if (!document.hidden) tick() }
        window.addEventListener('resize', onResize)
        var onVis = function () { if (!document.hidden) tick() }
        document.addEventListener('visibilitychange', onVis)
        return function () {
          alive = false
          clearInterval(timer)
          window.removeEventListener('resize', onResize)
          document.removeEventListener('visibilitychange', onVis)
        }
      }, [])

      if (pos === null) return null
      var label = (on ? '标准化交接手续：自动点亮（未单独设置的会话，点击关闭）' : '标准化交接手续：自动点亮（未单独设置的会话，点击开启）')
      if (autoArmErr) label += '（上次操作失败，请重试；宿主可能需要重启到新版）'
      return ReactDOM.createPortal(
        h('span', {
          className: 'dsh-handover-autoarm-wrap',
          style: { position: 'fixed', top: pos.top, left: pos.left, zIndex: 40 },
          'data-dsh-handover-autoarm-pos': '',
        },
          h('button', {
            type: 'button',
            className: 'dsh-handover-autoarm',
            'data-dsh-handover-autoarm': '',
            'data-active': on ? 'true' : undefined,
            'aria-label': label,
            'aria-pressed': on,
            title: label,
            onClick: function () {
              if (busyRef.current) return
              busyRef.current = true
              autoArmErr = false
              writeAutoArm(!on).then(function (v) { setOn2(v); busyRef.current = false })
                .catch(function () { autoArmErr = true; setOn2(autoArmCache); busyRef.current = false })
            },
          },
            // 与会话按钮同款「交接棒」图标
            h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
              h('path', { d: 'M3 8h11' }),
              h('path', { d: 'm11 5 3 3-3 3' }),
              h('path', { d: 'M21 16H10' }),
              h('path', { d: 'm13 13-3 3 3 3' }),
              h('circle', { cx: 12, cy: 12, r: 1.1, fill: 'currentColor', stroke: 'none' })
            )
          )
        ),
        document.body
      )
    }

    function HandoverToggle(props) {
      var sessionId = props.sessionId || ''
      var onState = React.useState(false)
      var on = onState[0]
      var setOn = onState[1]
      var degState = React.useState(false)
      var deg = degState[0]
      var setDeg = degState[1]
      var busyRef = React.useRef(false)
      var errState = React.useState(false)
      var err = errState[0]
      var setErr = errState[1]
      var lastSid = React.useRef(null)

      // sessionId 切换：同步切到该会话的已知状态，避免异步 read 前串显上一会话。
      if (lastSid.current !== sessionId) {
        lastSid.current = sessionId
        var known = cache[sessionId] === true
        if (on !== known) setOn(known)
        if (deg !== (degradedCache[sessionId] === true)) setDeg(degradedCache[sessionId] === true)
        if (err) setErr(false)
      }

      React.useEffect(function () {
        if (!sessionId) return
        var alive = true
        read(sessionId).then(function (r) {
          if (!alive) return
          setOn(r.on)
          setDeg(r.degraded)
        })
        return function () { alive = false }
      }, [sessionId])

      var label = deg
        ? '标准化交接手续：状态不可读（session-state.json 异常）'
        : on ? '标准化交接手续：已启用（点击关闭）' : '启用标准化交接手续'
      if (err) label += '（上次操作失败，请重试）'

      function click() {
        if (!sessionId || busyRef.current) return
        busyRef.current = true
        setErr(false)
        write(sessionId, !on).then(function (res) {
          if (res && res.ok) {
            setOn(res.value)
            setDeg(false)
          } else setErr(true)
          busyRef.current = false
        }).catch(function () {
          setErr(true)
          busyRef.current = false
        })
      }

      return h('button', {
        type: 'button',
        className: 'dsh-handover-toggle',
        'data-dsh-handover-toggle': '',
        'data-active': on ? 'true' : undefined,
        'data-degraded': deg ? 'true' : undefined,
        'aria-label': label,
        'aria-pressed': on,
        title: label,
        onClick: click,
      },
        // 「交接棒」：两个相向的箭头 + 中间交接点，比折线更像"移交/接手"
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('path', { d: 'M3 8h11' }),
          h('path', { d: 'm11 5 3 3-3 3' }),
          h('path', { d: 'M21 16H10' }),
          h('path', { d: 'm13 13-3 3 3 3' }),
          h('circle', { cx: 12, cy: 12, r: 1.1, fill: 'currentColor', stroke: 'none' }),
        )
      )
    }

    function apply(ctx) {
      injectStyles()
      ctx.slots.inject(SLOT, function () {
        return ctx.slots.register({
          name: SLOT,
          id: ID,
          order: 30,
          registrant: 'dsh-handover-protocol',
          // 本机宿主传入的确为 string（context-diagnostics-ui.tsx:216）。
          // 对象兜底只为跨版本兼容：解析不出 id 时返回空对象（不注入任何 key），
          // 让宿主 standard props 的 sessionId 兜底——返回 {sessionId:''} 会遮蔽标准值。
          inject: function (arg) {
            var sid = typeof arg === 'string' ? arg
              : (arg && typeof arg === 'object' ? (arg.id || arg.sessionId || '') : '')
            return sid ? { sessionId: String(sid) } : {}
          },
        }, HandoverToggle)
      })
      // blank 会话没有 sessionId，utilities 槽也不渲染；备用入口挂 root 作用域的
      // shell.overlay（常驻），只在「新会话自动点亮」场景可见（非 blank 让位）。
      ctx.slots.inject(OVERLAY_SLOT, function () {
        return ctx.slots.register({
          name: OVERLAY_SLOT,
          id: AUTOARM_ID,
          order: 90,
          registrant: 'dsh-handover-protocol',
        }, HandoverAutoArm)
      })
    }

    exports.isPlugin = true
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
