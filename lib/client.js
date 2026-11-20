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
    var h = React.createElement
    var SLOT = 'conversation.session.header.utilities'
    var ID = 'dsh-handover-protocol:toggle'

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
          return { ok: true, value: actual, degraded: false }
        })
      })
      inflight[sessionId] = next.catch(function () {})
      return next
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
      var errRef = React.useRef(null)
      var lastSid = React.useRef(null)

      // sessionId 切换：同步切到该会话的已知状态，避免异步 read 前串显上一会话。
      if (lastSid.current !== sessionId) {
        lastSid.current = sessionId
        var known = cache[sessionId] === true
        if (on !== known) setOn(known)
        if (deg !== (degradedCache[sessionId] === true)) setDeg(degradedCache[sessionId] === true)
        errRef.current = null
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
      if (errRef.current) label += '（上次操作失败，请重试）'

      function click() {
        if (!sessionId || busyRef.current) return
        busyRef.current = true
        errRef.current = null
        write(sessionId, !on).then(function (res) {
          if (res && res.ok) {
            setOn(res.value)
            setDeg(false)
          } else errRef.current = true
          busyRef.current = false
        }).catch(function () {
          errRef.current = true
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
        // 不依赖本机不存在的 --dsh-* 变量：用确定颜色 + 实心边框表达两态。
        // 暗色下关闭态用可见灰边框+灰图标，打开态用蓝底白图标，肉眼可辨。
        // degraded（状态文件不可读）用红边框警示。
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, padding: 0, borderRadius: 6,
          border: deg ? '1px solid #e05252' : on ? '1px solid #4c8bf5' : '1px solid #6b7280',
          background: deg ? 'rgba(224,82,82,0.15)' : on ? '#4c8bf5' : 'rgba(128,128,128,0.12)',
          color: deg ? '#e05252' : on ? '#ffffff' : '#9ca3af',
          cursor: 'pointer', opacity: 1, transition: 'background .15s,border-color .15s',
        },
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
    }

    exports.isPlugin = true
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
