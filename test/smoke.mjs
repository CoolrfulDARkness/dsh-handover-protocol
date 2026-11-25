// Minimal host-side smoke test for dsh-handover-protocol.
// Run with: npm test  (node --test test/smoke.mjs)
// No dependencies, no network, no GUI. It copies the host entry into a temp
// directory so STATE_FILE points there, then drives the public host contracts.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-handover-smoke-'))
const PLUGIN_COPY = path.join(TMP_ROOT, 'dsh-handover-protocol')
fs.cpSync(REPO_ROOT, PLUGIN_COPY, { recursive: true })
fs.rmSync(path.join(PLUGIN_COPY, '.git'), { recursive: true, force: true })

const STATE_FILE = path.join(PLUGIN_COPY, 'session-state.json')
const PROTOCOL_FILE = path.join(PLUGIN_COPY, 'protocol', 'HANDOVER-PROTOCOL.md')

async function loadPlugin() {
  const url = pathToFileURL(path.join(PLUGIN_COPY, 'index.js')).href
  return import(`${url}?smoke=${Date.now()}-${Math.random()}`)
}

function harness() {
  const registrations = { systemPrompt: null, tools: [], webServer: null }
  const disposers = []
  const fence = { pass: true }
  const ctx = {
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') disposers.push(d)
      return d
    },
    systemPrompt: {
      context(spec) {
        registrations.systemPrompt = spec
        return () => {}
      },
    },
    tools: {
      register(tool) {
        registrations.tools.push(tool)
        return () => {}
      },
    },
    webServer: {
      register(spec) {
        registrations.webServer = spec
        return () => {}
      },
    },
    connection: {
      requestRejection() {
        return fence.pass ? undefined : 'rejected'
      },
    },
  }
  const dispose = () => { for (const d of disposers) { try { d() } catch {} } }
  return { ctx, registrations, dispose, fence }
}

function requestHarness({ method = 'POST', urlPath = '/handover/api/state', body = {}, rawBody } = {}) {
  const payload = rawBody !== undefined ? rawBody : JSON.stringify(body)
  const req = {
    method,
    url: urlPath,
    headersSent: false,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8')
    },
  }
  let status = null
  let responseBody = null
  const res = {
    headersSent: false,
    writeHead(code) {
      status = code
      this.headersSent = true
    },
    end(chunk) {
      responseBody = JSON.parse(String(chunk))
    },
    destroy() {},
  }
  return { req, res, result: () => ({ status, body: responseBody }) }
}

test('registers the four host contracts and declares the supported DSH range', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.engines.node, '>=20')
  assert.equal(pkg.engines.dsh, '>=0.2.1-rc.5 <0.4.0-0')
  assert.match(pkg.description, /DSH >=0\.2\.1-rc\.5 <0\.4\.0-0/)

  const client = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(client, /conversation\.session\.header\.utilities/)
  assert.match(client, /data-dsh-handover-toggle/)
  assert.match(client, /var rel = 'handover\/api\/' \+ method/)
  assert.match(client, /request\('toggle', \{ sessionId: sessionId, on: on \}\)/)
  assert.match(client, /request\('state', \{ sessionId: sessionId \}\)/)

  const mod = await loadPlugin()
  assert.equal(mod.name, 'dsh-handover-protocol')
  assert.deepEqual(mod.inject, ['systemPrompt', 'tools', 'webServer', 'connection'])
  const h = harness()
  const dispose = mod.apply(h.ctx, { protocolPath: PROTOCOL_FILE })
  assert.equal(typeof dispose, 'function')
  assert.equal(h.registrations.systemPrompt.name, 'handover-protocol')
  assert.equal(h.registrations.tools.length, 1)
  assert.equal(h.registrations.tools[0].name, 'handover_status')
  assert.equal(h.registrations.webServer.kind, 'prefix')
  assert.equal(h.registrations.webServer.path, '/handover/api')
  dispose()
  h.dispose()
})

test('toggle round-trip is per session, and only a lit session is injected', async () => {
  fs.rmSync(STATE_FILE, { force: true })
  const mod = await loadPlugin()
  const h = harness()
  mod.apply(h.ctx, { protocolPath: PROTOCOL_FILE })
  const handler = h.registrations.webServer.handler

  const s1 = requestHarness({ urlPath: '/handover/api/state', body: { sessionId: 'session-A' } })
  await handler(s1.req, s1.res)
  assert.equal(s1.result().status, 200)
  assert.equal(s1.result().body.enabled, false)
  assert.equal(s1.result().body.degraded, false)

  const on = requestHarness({ urlPath: '/handover/api/toggle', body: { sessionId: 'session-A', on: true } })
  await handler(on.req, on.res)
  assert.equal(on.result().status, 200)
  assert.equal(on.result().body.enabled, true)

  const text = h.registrations.systemPrompt.text
  const lit = text({ agent: { session: { id: 'session-A' } } })
  assert.match(lit, /已启用/)
  assert.match(lit, /HANDOVER-PROTOCOL\.md/)
  assert.equal(text({ agent: { session: { id: 'session-B' } } }), '')

  const off = requestHarness({ urlPath: '/handover/api/toggle', body: { sessionId: 'session-A', on: false } })
  await handler(off.req, off.res)
  assert.equal(off.result().status, 200)
  assert.equal(off.result().body.enabled, false)
  assert.equal(text({ agent: { session: { id: 'session-A' } } }), '')
  assert.deepEqual(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')), { 'session-A': false })
})

test('corrupted state is visible degraded and refuses writes', async () => {
  fs.writeFileSync(STATE_FILE, '{not-json', 'utf8')
  const mod = await loadPlugin()
  const h = harness()
  mod.apply(h.ctx, { protocolPath: PROTOCOL_FILE })
  const handler = h.registrations.webServer.handler

  const state = requestHarness({ urlPath: '/handover/api/state', body: { sessionId: 'session-A' } })
  await handler(state.req, state.res)
  assert.equal(state.result().status, 200)
  assert.equal(state.result().body.degraded, true)
  assert.equal(state.result().body.enabled, false)

  const toggle = requestHarness({ urlPath: '/handover/api/toggle', body: { sessionId: 'session-A', on: true } })
  await handler(toggle.req, toggle.res)
  assert.equal(toggle.result().status, 500)
  assert.equal(toggle.result().body.ok, false)

  assert.match(h.registrations.systemPrompt.text({ agent: { session: { id: 'session-A' } } }), /degraded/)
  const status = await h.registrations.tools[0].execute({}, { agent: { session: { id: 'session-A' } } })
  assert.equal(status.ok, true)
  assert.equal(status.enabled, false)
  assert.equal(status.degraded, true)
  assert.match(h.registrations.tools[0].output.render({}, status)[0].text, /状态不可读/)
  assert.equal(fs.readFileSync(STATE_FILE, 'utf8'), '{not-json')
})

test('API rejects bad methods, malformed bodies, oversized bodies, bad sessions and fence failures', async () => {
  fs.rmSync(STATE_FILE, { force: true })
  const mod = await loadPlugin()
  const h = harness()
  mod.apply(h.ctx, { protocolPath: PROTOCOL_FILE })
  const handler = h.registrations.webServer.handler

  const get = requestHarness({ method: 'GET', urlPath: '/handover/api/state' })
  await handler(get.req, get.res)
  assert.equal(get.result().status, 405)

  const badJson = requestHarness({ urlPath: '/handover/api/state', rawBody: '{' })
  await handler(badJson.req, badJson.res)
  assert.equal(badJson.result().status, 400)

  const tooBig = requestHarness({ urlPath: '/handover/api/state', rawBody: 'x'.repeat((1 << 20) + 1) })
  await handler(tooBig.req, tooBig.res)
  assert.equal(tooBig.result().status, 413)

  for (const sessionId of ['__proto__', '_autoArm', 'constructor', 'has space', 'x'.repeat(129)]) {
    const r = requestHarness({ urlPath: '/handover/api/state', body: { sessionId } })
    await handler(r.req, r.res)
    assert.equal(r.result().status, 400)
    assert.equal(r.result().body.error, 'invalid sessionId')
  }

  h.fence.pass = false
  const blocked = requestHarness({ urlPath: '/handover/api/state', body: { sessionId: 'session-A' } })
  await handler(blocked.req, blocked.res)
  h.fence.pass = true
  assert.equal(blocked.result().status, 403)
})

test('autoArm applies only to sessions with no explicit choice', async () => {
  fs.rmSync(STATE_FILE, { force: true })
  const mod = await loadPlugin()
  const h = harness()
  mod.apply(h.ctx, { protocolPath: PROTOCOL_FILE })
  const handler = h.registrations.webServer.handler

  const arm = requestHarness({ urlPath: '/handover/api/autoArm', body: { on: true } })
  await handler(arm.req, arm.res)
  assert.equal(arm.result().status, 200)
  assert.equal(arm.result().body.autoArm, true)

  const text = h.registrations.systemPrompt.text
  assert.match(text({ agent: { session: { id: 'fresh-session' } } }), /已启用/)
  const explicitOff = requestHarness({ urlPath: '/handover/api/toggle', body: { sessionId: 'opt-out', on: false } })
  await handler(explicitOff.req, explicitOff.res)
  assert.equal(text({ agent: { session: { id: 'opt-out' } } }), '')
})

test.after(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})
