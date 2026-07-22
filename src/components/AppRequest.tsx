import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  Send, Plus, Trash2, RefreshCw, Copy, ChevronDown, ChevronRight, AlertCircle, Globe, WrapText,
  Check, Clock, Trash, Search, X, Star, Download, Upload, Code2, Settings, KeyRound, Cookie,
  ListTree, FileText, Save, ChevronsUpDown, Layers
} from 'lucide-react'
import { Theme } from '../types'

interface AppRequestProps { theme: Theme }

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
type BodyType   = 'none' | 'form-data' | 'urlencoded' | 'json' | 'xml' | 'graphql' | 'raw' | 'binary'
type AuthType   = 'none' | 'basic' | 'bearer' | 'apikey'
type ReqTab     = 'params' | 'body' | 'headers' | 'auth' | 'cookies' | 'options' | 'history'
type ResTab     = 'body' | 'headers'
type ResViewMode = 'pretty' | 'tree' | 'raw'

interface KVPair { id: string; key: string; value: string; enabled: boolean }
interface BinaryFileInfo { path: string; name: string; size: number }

interface AuthState {
  type: AuthType
  basic: { username: string; password: string }
  bearer: { token: string }
  apikey: { key: string; value: string; in: 'header' | 'query' }
}

interface OptionsState {
  timeout: number             // ms, 0 = 无超时
  rejectUnauthorized: boolean // false = 忽略 SSL 证书错误
}

interface RequestState {
  method: HttpMethod; url: string
  params: KVPair[]
  headers: KVPair[]
  cookies: KVPair[]
  bodyType: BodyType
  bodyJson: string; bodyXml: string; bodyGql: string; bodyGqlVars: string; bodyRaw: string
  bodyBinary?: BinaryFileInfo
  formData: KVPair[]
  urlEncoded: KVPair[]
  auth: AuthState
  options: OptionsState
  name?: string
}

interface ResponseState {
  status: number; statusText: string; time: number; size: number
  headers: Record<string, string>; body: string; bodyBase64?: string; contentType: string; error?: string
}

interface HistoryEntry { id: string; timestamp: number; method: HttpMethod; url: string; req: RequestState; response?: ResponseState }
interface CollectionItem { id: string; name: string; req: RequestState; createdAt: number }
interface Environment { id: string; name: string; vars: Record<string, string> }

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
const METHOD_DARK: Record<HttpMethod, { text: string; bg: string; border: string }> = {
  GET:     { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  POST:    { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30'  },
  PUT:     { text: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30'   },
  DELETE:  { text: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30'    },
  PATCH:   { text: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/30' },
  HEAD:    { text: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30'   },
  OPTIONS: { text: 'text-pink-400',    bg: 'bg-pink-500/10',    border: 'border-pink-500/30'   },
}
const METHOD_LIGHT: Record<HttpMethod, { text: string; bg: string; border: string }> = {
  GET:     { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  POST:    { text: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200'   },
  PUT:     { text: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200'    },
  DELETE:  { text: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200'     },
  PATCH:   { text: 'text-purple-700',  bg: 'bg-purple-50',  border: 'border-purple-200'  },
  HEAD:    { text: 'text-cyan-700',    bg: 'bg-cyan-50',    border: 'border-cyan-200'    },
  OPTIONS: { text: 'text-pink-700',    bg: 'bg-pink-50',    border: 'border-pink-200'    },
}

const COMMON_HEADER_KEYS = [
  'Accept', 'Accept-Encoding', 'Accept-Language', 'Authorization', 'Cache-Control',
  'Content-Type', 'Cookie', 'Origin', 'Referer', 'User-Agent', 'X-Requested-With',
  'X-API-Key', 'X-Auth-Token', 'X-Forwarded-For',
]
const COMMON_CONTENT_TYPES = [
  'application/json', 'application/xml', 'application/x-www-form-urlencoded',
  'multipart/form-data', 'text/plain', 'text/html', 'text/xml',
]

const HISTORY_KEY = 'mk-req-history'
const COLLECTIONS_KEY = 'mk-req-collections'
const ENVS_KEY = 'mk-req-envs'
const ACTIVE_ENV_KEY = 'mk-req-active-env'
const MAX_HISTORY = 100

function mkKV(): KVPair { return { id: Math.random().toString(36).slice(2), key: '', value: '', enabled: true } }
function mkKVFrom(k: string, v: string): KVPair { return { id: Math.random().toString(36).slice(2), key: k, value: v, enabled: true } }

const INIT_AUTH: AuthState = {
  type: 'none',
  basic: { username: '', password: '' },
  bearer: { token: '' },
  apikey: { key: '', value: '', in: 'header' },
}
const INIT_OPTIONS: OptionsState = { timeout: 30000, rejectUnauthorized: true }
const INIT_REQ: RequestState = {
  method: 'GET', url: '',
  params: [mkKV()],
  headers: [mkKV()],
  cookies: [mkKV()],
  bodyType: 'none',
  bodyJson: '{\n  \n}',
  bodyXml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  \n</root>',
  bodyGql: '{\n  \n}', bodyGqlVars: '{}',
  bodyRaw: '',
  formData: [mkKV()],
  urlEncoded: [mkKV()],
  auth: INIT_AUTH,
  options: INIT_OPTIONS,
}

// ── Storage helpers ─────────────────────────────────────────────────────────
function loadJson<T>(key: string, def: T): T { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : def } catch { return def } }
function saveJson(key: string, val: unknown) { try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore quota */ } }

// ── Format functions ────────────────────────────────────────────────────────
function tryFormatJson(str: string): { result: string; error?: string } {
  try { return { result: JSON.stringify(JSON.parse(str), null, 2) } } catch (e1) {
    try {
      const fixed = str.replace(/,(\s*[}\]])/g, '$1').replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":').replace(/:\s*'([^']*)'/g, ': "$1"')
      return { result: JSON.stringify(JSON.parse(fixed), null, 2) }
    } catch {
      return { result: str, error: `JSON 格式错误：${e1 instanceof Error ? e1.message : String(e1)}` }
    }
  }
}

function tryFormatXml(xml: string): { result: string; error?: string } {
  try {
    const doc = new DOMParser().parseFromString(xml.trim(), 'application/xml')
    const err = doc.querySelector('parsererror')
    if (err) return { result: xml, error: `XML 解析错误：${err.textContent?.split('\n')[0]?.trim() ?? '格式不合法'}` }
    function ser(node: Node, d: number): string {
      const pad = '  '.repeat(d)
      if (node.nodeType === Node.TEXT_NODE) { const t = (node.textContent ?? '').trim(); return t ? pad + t : '' }
      if (node.nodeType === Node.COMMENT_NODE) return `${pad}<!--${node.textContent}-->`
      if (node.nodeType !== Node.ELEMENT_NODE) return ''
      const el = node as Element
      const attrs = Array.from(el.attributes).map(a => ` ${a.name}="${a.value}"`).join('')
      const kids = Array.from(el.childNodes)
      const hasEl = kids.some(c => c.nodeType === Node.ELEMENT_NODE)
      if (!kids.length) return `${pad}<${el.tagName}${attrs}/>`
      if (!hasEl) return `${pad}<${el.tagName}${attrs}>${el.textContent?.trim()}</${el.tagName}>`
      return `${pad}<${el.tagName}${attrs}>\n${kids.map(c => ser(c, d + 1)).filter(Boolean).join('\n')}\n${pad}</${el.tagName}>`
    }
    const decl = xml.trimStart().startsWith('<?xml') ? '<?xml version="1.0" encoding="UTF-8"?>\n' : ''
    return { result: decl + ser(doc.documentElement, 0) }
  } catch (e) { return { result: xml, error: `XML 格式化失败：${e instanceof Error ? e.message : String(e)}` } }
}

function tryFormatHtml(html: string): { result: string; error?: string } {
  try {
    const doc = new DOMParser().parseFromString(html.trim(), 'text/html')
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
    function ser(node: Node, d: number): string {
      const pad = '  '.repeat(d)
      if (node.nodeType === Node.TEXT_NODE) { const t = (node.textContent ?? '').trim(); return t ? pad + t : '' }
      if (node.nodeType === Node.COMMENT_NODE) return `${pad}<!--${node.textContent}-->`
      if (node.nodeType !== Node.ELEMENT_NODE) return ''
      const el = node as Element
      const attrs = Array.from(el.attributes).map(a => ` ${a.name}="${a.value}"`).join('')
      const tag = el.tagName.toLowerCase()
      if (VOID.has(tag)) return `${pad}<${tag}${attrs}>`
      const kids = Array.from(el.childNodes)
      const hasEl = kids.some(c => c.nodeType === Node.ELEMENT_NODE)
      if (!kids.length) return `${pad}<${tag}${attrs}></${tag}>`
      if (!hasEl) return `${pad}<${tag}${attrs}>${el.textContent?.trim()}</${tag}>`
      return `${pad}<${tag}${attrs}>\n${kids.map(c => ser(c, d + 1)).filter(Boolean).join('\n')}\n${pad}</${tag}>`
    }
    const parts: string[] = []
    const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : ''
    if (doctype) parts.push(doctype)
    parts.push(ser(doc.documentElement, 0))
    return { result: parts.filter(Boolean).join('\n') }
  } catch (e) { return { result: html, error: `HTML 格式化失败：${e instanceof Error ? e.message : String(e)}` } }
}

function tryFormatGql(gql: string): { result: string; error?: string } {
  try {
    const tokens = gql.replace(/\{/g, ' { ').replace(/\}/g, ' } ').split(/\s+/).filter(Boolean)
    let depth = 0; const lines: string[] = []; let cur = ''
    for (const t of tokens) {
      if (t === '{') { lines.push('  '.repeat(depth) + (cur.trim() ? cur.trim() + ' {' : '{')); cur = ''; depth++ }
      else if (t === '}') { if (cur.trim()) { lines.push('  '.repeat(depth) + cur.trim()); cur = '' } depth = Math.max(0, depth - 1); lines.push('  '.repeat(depth) + '}') }
      else cur += (cur ? ' ' : '') + t
    }
    if (cur.trim()) lines.push('  '.repeat(depth) + cur.trim())
    if (depth !== 0) return { result: gql, error: 'GraphQL 括号不匹配，请检查花括号是否成对' }
    return { result: lines.join('\n') }
  } catch (e) { return { result: gql, error: `GraphQL 格式化失败：${e instanceof Error ? e.message : String(e)}` } }
}

// 按 content-type 自动格式化响应体
function autoFormatResponse(body: string, ct: string): string {
  const c = ct.toLowerCase()
  if (c.includes('json')) return tryFormatJson(body).result
  if (c.includes('xml')) return tryFormatXml(body).result
  if (c.includes('html')) return tryFormatHtml(body).result
  return body
}

// ── Variable interpolation: {{var}} → env value ────────────────────────────
function interpolate(text: string, vars: Record<string, string>): string {
  if (!text) return text
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`))
}
function interpolateKV(pairs: KVPair[], vars: Record<string, string>): KVPair[] {
  return pairs.map(p => ({ ...p, key: interpolate(p.key, vars), value: interpolate(p.value, vars) }))
}

// ── cURL parser ─────────────────────────────────────────────────────────────
// 已知有值但当前工具不处理的 flag（跳过其值，避免值被误当作 URL）
const CURL_SKIP_WITH_VALUE = new Set([
  '-A', '--user-agent',
  '-e', '--referer',
  '-c', '--cookie-jar',
  '-F', '--form',
  '-x', '--proxy',
  '-o', '--output',
  '-O', '--remote-name',
  '-w', '--write-out',
  '-r', '--range',
  '-T', '--upload-file',
  '--url',
  '--resolve',
  '--connect-to',
  '-D', '--dump-header',
])
// 解析 Cookie header 或 -b 参数字符串为 KV 数组
function parseCookieString(s: string): KVPair[] {
  const out: KVPair[] = []
  s.split(';').forEach(seg => {
    const t = seg.trim()
    if (!t) return
    const eq = t.indexOf('=')
    const k = eq >= 0 ? t.slice(0, eq).trim() : t
    const v = eq >= 0 ? t.slice(eq + 1).trim() : ''
    if (k) out.push(mkKVFrom(k, v))
  })
  return out
}
// 显式无值 flag（不吞掉下一个 token）
const CURL_NO_VALUE = new Set([
  '-k', '--insecure',
  '--compressed', '--compressed-ssh',
  '-L', '--location',
  '-v', '--verbose',
  '-I', '--head',
  '-i', '--include',
  '-s', '--silent',
  '-S', '--show-error',
  '-f', '--fail',
  '-J', '--remote-header-name',
  '--http1.0', '--http1.1', '--http2', '--http3',
  '-N', '--no-buffer',
  '-#', '--progress-bar',
  '-g', '--globoff',
  '--tlsv1.2', '--tlsv1.3',
  '--parallel', '-Z',
])

function parseCurl(cmd: string): Partial<RequestState> | null {
  // 兼容 Windows cmd 的 ^ 续行 和 Unix 的 \ 续行
  let s = cmd.trim()
    .replace(/\\\r?\n\s*/g, ' ')
    .replace(/\^\r?\n\s*/g, ' ')
    .replace(/^curl\s+/i, '')
  if (!s) return null
  const tokens: string[] = []
  let cur = ''; let inStr = false; let quote = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (c === '\\' && (s[i + 1] === quote || s[i + 1] === '\\')) { cur += s[i + 1]; i++ }
      else if (c === quote) { inStr = false; tokens.push(cur); cur = '' }
      else cur += c
    } else {
      if (c === '"' || c === "'") { if (cur) { tokens.push(cur); cur = '' } inStr = true; quote = c }
      else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { if (cur) { tokens.push(cur); cur = '' } }
      else cur += c
    }
  }
  if (cur) tokens.push(cur)

  const out: Partial<RequestState> = {
    method: 'GET' as HttpMethod, url: '',
    headers: [], params: [], cookies: [], formData: [], urlEncoded: [],
    bodyType: 'none' as BodyType,
    auth: { ...INIT_AUTH },
  }
  const headers: KVPair[] = []
  let bodyStr: string | undefined
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '-X' || t === '--request') { out.method = (tokens[++i] || 'GET').toUpperCase() as HttpMethod }
    else if (t === '-H' || t === '--header') {
      const h = tokens[++i]; if (!h) continue
      const idx = h.indexOf(':')
      if (idx > 0) {
        const key = h.slice(0, idx).trim()
        const val = h.slice(idx + 1).trim()
        // Cookie header 特殊处理：拆解到 cookies tab，避免与 Cookies 页签重复
        if (key.toLowerCase() === 'cookie') {
          out.cookies = [...(out.cookies || []), ...parseCookieString(val)]
        } else {
          headers.push({ id: Math.random().toString(36).slice(2), key, value: val, enabled: true })
        }
      }
    }
    else if (t === '-b' || t === '--cookie') {
      const cookieStr = tokens[++i]
      if (cookieStr) out.cookies = [...(out.cookies || []), ...parseCookieString(cookieStr)]
    }
    else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii' || t === '--data-urlencode') {
      bodyStr = tokens[++i]
      if (out.method === 'GET') out.method = 'POST' as HttpMethod
    }
    else if (t === '-u' || t === '--user') {
      const raw = tokens[++i] || ''
      const idx = raw.indexOf(':')
      const u = idx >= 0 ? raw.slice(0, idx) : raw
      const p = idx >= 0 ? raw.slice(idx + 1) : ''
      out.auth = { ...INIT_AUTH, type: 'basic', basic: { username: u, password: p } }
    }
    else if (t === '-k' || t === '--insecure') {
      out.options = { timeout: INIT_OPTIONS.timeout, rejectUnauthorized: false }
    }
    else if (t === '--max-time' || t === '--connect-timeout') {
      const v = parseFloat(tokens[++i] || '0')
      if (!isNaN(v)) out.options = { rejectUnauthorized: out.options?.rejectUnauthorized ?? true, timeout: Math.round(v * 1000) }
    }
    else if (CURL_NO_VALUE.has(t)) {
      // 无值 flag：忽略即可，不消耗下一个 token
    }
    else if (CURL_SKIP_WITH_VALUE.has(t)) {
      // 有值但不处理：吞掉下一个 token 避免它被误认为 URL
      i++
    }
    else if (t.startsWith('-')) {
      // 未识别的 flag：保守跳过自身；不吞下一个 token（避免误吃 URL）。
      // 副作用：若该 flag 有值且下一个 token 是值，可能被当作 URL——但比误丢 URL 更安全。
    }
    else if (!out.url) { out.url = t }
  }
  out.headers = headers.length ? headers : [mkKV()]

  // 从 URL 中拆分 query params 到 params tab
  if (out.url) {
    const qIdx = out.url.indexOf('?')
    if (qIdx >= 0) {
      const pathPart = out.url.slice(0, qIdx)
      const qsPart = out.url.slice(qIdx + 1)
      const params: KVPair[] = []
      qsPart.split('&').filter(Boolean).forEach(seg => {
        const eq = seg.indexOf('=')
        const k = eq >= 0 ? seg.slice(0, eq) : seg
        const v = eq >= 0 ? seg.slice(eq + 1) : ''
        try { params.push(mkKVFrom(decodeURIComponent(k), decodeURIComponent(v))) } catch { params.push(mkKVFrom(k, v)) }
      })
      if (params.length > 0) {
        out.url = pathPart
        out.params = params
      }
    }
  }

  if (bodyStr !== undefined) {
    const ct = headers.find(h => h.key.toLowerCase() === 'content-type')
    if (ct && ct.value.includes('json')) { out.bodyType = 'json'; out.bodyJson = bodyStr }
    else if (ct && ct.value.includes('xml')) { out.bodyType = 'xml'; out.bodyXml = bodyStr }
    else if (bodyStr.trim().startsWith('{') || bodyStr.trim().startsWith('[')) { out.bodyType = 'json'; out.bodyJson = bodyStr }
    else if (bodyStr.includes('=') && !bodyStr.includes('\n')) {
      out.bodyType = 'urlencoded'
      out.urlEncoded = bodyStr.split('&').map(p => {
        const eq = p.indexOf('=')
        const k = eq >= 0 ? p.slice(0, eq) : p
        const v = eq >= 0 ? p.slice(eq + 1) : ''
        try { return mkKVFrom(decodeURIComponent(k), decodeURIComponent(v)) } catch { return mkKVFrom(k, v) }
      })
    } else { out.bodyType = 'raw'; out.bodyRaw = bodyStr }
  }
  return out
}

// ── Build resolved request (params + auth + cookies + interpolation) ───────
interface ResolvedRequest {
  url: string
  method: HttpMethod
  headers: Record<string, string>
  body?: string
  bodyEncoding?: 'text' | 'base64'
  timeout: number
  rejectUnauthorized: boolean
}
function buildResolvedRequest(req: RequestState, vars: Record<string, string>): ResolvedRequest {
  // 1. URL + query params
  let url = interpolate(req.url.trim(), vars)
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url

  const enabledParams = interpolateKV(req.params, vars).filter(p => p.enabled && p.key)
  // API Key in query
  if (req.auth.type === 'apikey' && req.auth.apikey.in === 'query' && req.auth.apikey.key) {
    enabledParams.push({ id: '_ak', key: interpolate(req.auth.apikey.key, vars), value: interpolate(req.auth.apikey.value, vars), enabled: true })
  }
  if (enabledParams.length > 0) {
    const usp = new URLSearchParams()
    enabledParams.forEach(p => usp.append(p.key, p.value))
    const qs = usp.toString()
    url += (url.includes('?') ? '&' : '?') + qs
  }

  // 2. Headers（含 Auth 生成 + Cookies 合成）
  const headers: Record<string, string> = {}
  interpolateKV(req.headers, vars).filter(h => h.enabled && h.key).forEach(h => { headers[h.key] = h.value })

  if (req.auth.type === 'basic') {
    const u = interpolate(req.auth.basic.username, vars)
    const p = interpolate(req.auth.basic.password, vars)
    if (u || p) headers['Authorization'] = 'Basic ' + btoa(`${u}:${p}`)
  } else if (req.auth.type === 'bearer') {
    const t = interpolate(req.auth.bearer.token, vars)
    if (t) headers['Authorization'] = `Bearer ${t}`
  } else if (req.auth.type === 'apikey' && req.auth.apikey.in === 'header') {
    const k = interpolate(req.auth.apikey.key, vars)
    const v = interpolate(req.auth.apikey.value, vars)
    if (k) headers[k] = v
  }

  const cookies = interpolateKV(req.cookies, vars).filter(c => c.enabled && c.key)
  if (cookies.length > 0) {
    headers['Cookie'] = cookies.map(c => `${c.key}=${c.value}`).join('; ')
  }

  // 3. Body
  let body: string | undefined
  let bodyEncoding: 'text' | 'base64' | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.bodyType === 'json') { body = interpolate(req.bodyJson, vars); if (!hasHeader(headers, 'Content-Type')) headers['Content-Type'] = 'application/json' }
    else if (req.bodyType === 'xml') { body = interpolate(req.bodyXml, vars); if (!hasHeader(headers, 'Content-Type')) headers['Content-Type'] = 'application/xml' }
    else if (req.bodyType === 'raw') { body = interpolate(req.bodyRaw, vars); if (!hasHeader(headers, 'Content-Type')) headers['Content-Type'] = 'text/plain' }
    else if (req.bodyType === 'graphql') {
      const b: { query: string; variables?: unknown } = { query: interpolate(req.bodyGql, vars) }
      if (req.bodyGqlVars.trim()) { try { b.variables = JSON.parse(interpolate(req.bodyGqlVars, vars)) } catch { /* ignore */ } }
      body = JSON.stringify(b); if (!hasHeader(headers, 'Content-Type')) headers['Content-Type'] = 'application/json'
    } else if (req.bodyType === 'urlencoded') {
      const enabled = interpolateKV(req.urlEncoded, vars).filter(f => f.enabled && f.key)
      const usp = new URLSearchParams()
      enabled.forEach(f => usp.append(f.key, f.value))
      body = usp.toString()
      if (!hasHeader(headers, 'Content-Type')) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    } else if (req.bodyType === 'form-data') {
      const boundary = '----Boundary' + Math.random().toString(36).slice(2)
      const parts = interpolateKV(req.formData, vars).filter(f => f.enabled && f.key)
        .map(f => `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"\r\n\r\n${f.value}`)
      body = parts.join('\r\n') + `\r\n--${boundary}--\r\n`
      if (!hasHeader(headers, 'Content-Type')) headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`
    }
    // binary: 由调用方读取文件后传入 body（base64） + bodyEncoding='base64'
  }
  return {
    url, method: req.method, headers, body, bodyEncoding,
    timeout: req.options.timeout, rejectUnauthorized: req.options.rejectUnauthorized,
  }
}
function hasHeader(h: Record<string, string>, k: string): boolean {
  const kl = k.toLowerCase()
  return Object.keys(h).some(x => x.toLowerCase() === kl)
}

// ── Code generators ─────────────────────────────────────────────────────────
function generateCurl(r: ResolvedRequest): string {
  const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const parts = [`curl -X ${r.method}`]
  parts.push(`  ${shq(r.url)}`)
  for (const [k, v] of Object.entries(r.headers)) parts.push(`  -H ${shq(`${k}: ${v}`)}`)
  if (r.body && r.bodyEncoding !== 'base64') parts.push(`  --data-raw ${shq(r.body)}`)
  if (r.body && r.bodyEncoding === 'base64') parts.push(`  --data-binary @<(base64 -d <<< '${r.body}')`)
  if (!r.rejectUnauthorized) parts.push('  -k')
  if (r.timeout > 0) parts.push(`  --max-time ${(r.timeout / 1000).toFixed(1)}`)
  return parts.join(' \\\n')
}
function generateFetch(r: ResolvedRequest): string {
  const opts: Record<string, unknown> = { method: r.method }
  if (Object.keys(r.headers).length > 0) opts.headers = r.headers
  if (r.body) opts.body = r.body
  return `fetch(${JSON.stringify(r.url)}, ${JSON.stringify(opts, null, 2)})
  .then(res => res.text())
  .then(data => console.log(data))
  .catch(err => console.error(err));`
}
function generateAxios(r: ResolvedRequest): string {
  const cfg: Record<string, unknown> = { method: r.method.toLowerCase(), url: r.url }
  if (Object.keys(r.headers).length > 0) cfg.headers = r.headers
  if (r.body) cfg.data = r.body
  if (r.timeout > 0) cfg.timeout = r.timeout
  return `axios(${JSON.stringify(cfg, null, 2)})
  .then(res => console.log(res.data))
  .catch(err => console.error(err));`
}

// ── Syntax highlighters ─────────────────────────────────────────────────────
function highlightJson(text: string, isDark: boolean): React.ReactNode {
  const RE = /("(?:[^"\\]|\\.)*"\s*:?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\],:])/g
  const parts: React.ReactNode[] = []; let last = 0; let m: RegExpExecArray | null; RE.lastIndex = 0
  while ((m = RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const [full, str, num, kw, punct] = m; const k = m.index
    if (str !== undefined) parts.push(<span key={k} style={{ color: full.trimEnd().endsWith(':') ? (isDark ? '#38bdf8' : '#0284c7') : (isDark ? '#34d399' : '#059669') }}>{full}</span>)
    else if (num !== undefined) parts.push(<span key={k} style={{ color: isDark ? '#fbbf24' : '#d97706' }}>{full}</span>)
    else if (kw !== undefined) parts.push(<span key={k} style={{ color: kw === 'null' ? (isDark ? '#71717a' : '#94a3b8') : (isDark ? '#60a5fa' : '#2563eb') }}>{full}</span>)
    else if (punct !== undefined) parts.push(<span key={k} style={{ color: isDark ? '#71717a' : '#94a3b8' }}>{full}</span>)
    last = m.index + full.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
function highlightXml(text: string, isDark: boolean): React.ReactNode {
  const C = isDark
    ? { tag: '#60a5fa', attr: '#fbbf24', val: '#34d399', cmt: '#71717a', decl: '#a78bfa', sym: '#71717a', txt: '#d4d4d8' }
    : { tag: '#2563eb', attr: '#d97706', val: '#059669', cmt: '#94a3b8', decl: '#7c3aed', sym: '#94a3b8', txt: '#475569' }
  const parts: React.ReactNode[] = []; let i = 0; let k = 0
  const sp = (color: string, s: string) => { parts.push(<span key={k++} style={{ color }}>{s}</span>) }
  while (i < text.length) {
    if (text[i] !== '<') {
      const end = text.indexOf('<', i); const t = end < 0 ? text.slice(i) : text.slice(i, end)
      sp(C.txt, t); i = end < 0 ? text.length : end; continue
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i); const t = end < 0 ? text.slice(i) : text.slice(i, end + 3)
      sp(C.cmt, t); i = end < 0 ? text.length : end + 3
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i); const t = end < 0 ? text.slice(i) : text.slice(i, end + 2)
      sp(C.decl, t); i = end < 0 ? text.length : end + 2
    } else if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i); if (end < 0) { sp(C.sym, text.slice(i)); break }
      sp(C.sym, '</'); sp(C.tag, text.slice(i + 2, end).trim()); sp(C.sym, '>'); i = end + 1
    } else {
      sp(C.sym, '<'); i++
      const nm = text.slice(i).match(/^[\w:.-]+/); if (!nm) { sp(C.sym, text[i] ?? ''); i++; continue }
      sp(C.tag, nm[0]); i += nm[0].length
      while (i < text.length && text[i] !== '>' && !(text[i] === '/' && text[i + 1] === '>')) {
        if (/\s/.test(text[i])) { parts.push(text[i]); i++; continue }
        const an = text.slice(i).match(/^[\w:.-]+/); if (!an) { parts.push(text[i]); i++; continue }
        sp(C.attr, an[0]); i += an[0].length
        if (text[i] === '=') {
          sp(C.sym, '='); i++
          const q = text[i]
          if (q === '"' || q === "'") {
            const end = text.indexOf(q, i + 1); const v = end < 0 ? text.slice(i) : text.slice(i, end + 1)
            sp(C.val, v); i = end < 0 ? text.length : end + 1
          }
        }
      }
      if (text.startsWith('/>', i)) { sp(C.sym, '/>'); i += 2 }
      else if (text[i] === '>') { sp(C.sym, '>'); i++ }
    }
  }
  return <>{parts}</>
}
function highlightGql(text: string, isDark: boolean): React.ReactNode {
  const C = isDark
    ? { kw: '#a78bfa', field: '#60a5fa', type: '#34d399', str: '#34d399', cmt: '#71717a', sym: '#71717a', num: '#fbbf24' }
    : { kw: '#7c3aed', field: '#2563eb', type: '#059669', str: '#059669', cmt: '#94a3b8', sym: '#94a3b8', num: '#d97706' }
  const KW = new Set(['query', 'mutation', 'subscription', 'fragment', 'on', 'type', 'input', 'enum', 'interface', 'union', 'scalar', 'directive', 'true', 'false', 'null'])
  const RE = /(#[^\n]*)|("""[\s\S]*?"""|"(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?)|([A-Z][_A-Za-z0-9]*)|([_a-z][_A-Za-z0-9]*)|([{}()\[\]:!,=@$])/g
  const parts: React.ReactNode[] = []; let last = 0; let k = 0; let m: RegExpExecArray | null; RE.lastIndex = 0
  while ((m = RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const [full] = m; const ki = k++
    if (m[1]) parts.push(<span key={ki} style={{ color: C.cmt }}>{full}</span>)
    else if (m[2]) parts.push(<span key={ki} style={{ color: C.str }}>{full}</span>)
    else if (m[3]) parts.push(<span key={ki} style={{ color: C.num }}>{full}</span>)
    else if (m[4]) parts.push(<span key={ki} style={{ color: C.type }}>{full}</span>)
    else if (m[5]) { parts.push(<span key={ki} style={{ color: KW.has(full) ? C.kw : C.field }}>{full}</span>) }
    else if (m[6]) parts.push(<span key={ki} style={{ color: C.sym }}>{full}</span>)
    last = m.index + full.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

// 高亮响应文本中的搜索关键词
function highlightSearch(text: string, keyword: string, isDark: boolean): React.ReactNode {
  const kw = keyword.trim()
  if (!kw) return text
  const parts: React.ReactNode[] = []
  const lower = text.toLowerCase()
  const kl = kw.toLowerCase()
  let i = 0; let k = 0
  while (i < text.length) {
    const idx = lower.indexOf(kl, i)
    if (idx < 0) { parts.push(text.slice(i)); break }
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(<mark key={k++} className={isDark ? 'bg-yellow-500/40 text-inherit rounded-[2px]' : 'bg-yellow-300/70 text-inherit rounded-[2px]'}>{text.slice(idx, idx + kw.length)}</mark>)
    i = idx + kw.length
  }
  return <>{parts}</>
}

// ── HighlightEditor with line numbers ──────────────────────────────────────
function HighlightEditor({ value, onChange, language, isDark, minHeight = 280, placeholder, fill = false, onSubmit, showLineNumbers = true }: {
  value: string; onChange: (v: string) => void
  language: 'json' | 'xml' | 'gql'
  isDark: boolean; minHeight?: number; placeholder?: string; fill?: boolean
  onSubmit?: () => void
  showLineNumbers?: boolean
}) {
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const lineCount = useMemo(() => Math.max(1, (value.match(/\n/g)?.length ?? 0) + 1), [value])
  const syncScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop
      preRef.current.scrollLeft = taRef.current.scrollLeft
    }
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop
    }
  }
  const highlighted = language === 'json' ? highlightJson(value, isDark)
    : language === 'xml' ? highlightXml(value, isDark)
    : highlightGql(value, isDark)
  const shared: React.CSSProperties = {
    fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
    fontSize: 12, lineHeight: '20px', padding: '10px 12px',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'break-word', tabSize: 2,
  }
  const gutterWidth = showLineNumbers ? Math.max(28, String(lineCount).length * 8 + 12) : 0
  return (
    <div
      className={`relative rounded-xl border transition-all focus-within:ring-1 ${fill ? 'flex-1 min-h-0' : ''} ${isDark ? 'bg-zinc-900 border-zinc-700/60 focus-within:border-blue-500/40 focus-within:ring-blue-500/10' : 'bg-white border-slate-200 focus-within:border-blue-400/60 focus-within:ring-blue-400/10'}`}
      style={fill ? undefined : { minHeight }}
    >
      {showLineNumbers && (
        <div
          ref={gutterRef}
          aria-hidden
          className={`absolute left-0 top-0 bottom-0 overflow-hidden select-none text-right pr-2 pt-[10px] pb-[10px] font-mono text-[11px] ${isDark ? 'text-zinc-600 border-r border-zinc-800' : 'text-slate-400 border-r border-slate-100'}`}
          style={{ width: gutterWidth, lineHeight: '20px' }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
      )}
      <pre ref={preRef} aria-hidden style={{ ...shared, position: 'absolute', inset: 0, left: gutterWidth, margin: 0, overflow: 'hidden', pointerEvents: 'none', color: isDark ? '#e4e4e7' : '#334155' }}>
        {highlighted}{'\n'}
      </pre>
      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).select() }
          else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSubmit?.() }
        }}
        spellCheck={false}
        placeholder={placeholder}
        style={{ ...shared, position: 'absolute', inset: 0, left: gutterWidth, width: `calc(100% - ${gutterWidth}px)`, height: '100%', background: 'transparent', color: 'transparent', caretColor: isDark ? '#e4e4e7' : '#1e293b', resize: 'none', border: 'none', outline: 'none', zIndex: 1 }}
        className={isDark ? 'placeholder-zinc-600' : 'placeholder-slate-300'}
      />
    </div>
  )
}

// ── KVEditor ────────────────────────────────────────────────────────────────
function KVEditor({ pairs, onChange, isDark, keyPh = 'Key', valPh = 'Value', keyList }: {
  pairs: KVPair[]; onChange: (p: KVPair[]) => void; isDark: boolean
  keyPh?: string; valPh?: string; keyList?: string[]
}) {
  const upd = (id: string, f: keyof KVPair, v: string | boolean) => onChange(pairs.map(p => p.id === id ? { ...p, [f]: v } : p))
  const inp = `flex-1 px-2.5 py-1.5 text-xs rounded-md border font-mono outline-none transition-all ${isDark ? 'bg-zinc-900 border-zinc-700/60 text-zinc-200 placeholder-zinc-600 focus:border-blue-500/50' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-300 focus:border-blue-400'}`
  const listId = 'kvlist_' + Math.random().toString(36).slice(2, 8)
  return (
    <div>
      {keyList && <datalist id={listId}>{keyList.map(k => <option key={k} value={k} />)}</datalist>}
      <div className={`flex items-center gap-1.5 px-1 mb-1.5 ${isDark ? 'text-zinc-600' : 'text-slate-400'}`}>
        <div className="w-4 shrink-0" />
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider">{keyPh}</span>
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider">{valPh}</span>
        <div className="w-6 shrink-0" />
      </div>
      <div className="space-y-1">
        {pairs.map(p => (
          <div key={p.id} className={`flex items-center gap-1.5 group rounded-md px-1 py-0.5 ${isDark ? 'hover:bg-zinc-800/50' : 'hover:bg-slate-50'}`}>
            <input type="checkbox" checked={p.enabled} onChange={e => upd(p.id, 'enabled', e.target.checked)} className="shrink-0 w-3.5 h-3.5 accent-blue-500 cursor-pointer" />
            <input value={p.key} onChange={e => upd(p.id, 'key', e.target.value)} placeholder={keyPh} className={inp} list={keyList ? listId : undefined} />
            <input value={p.value} onChange={e => upd(p.id, 'value', e.target.value)} placeholder={valPh} className={inp} />
            <button onClick={() => onChange(pairs.filter(x => x.id !== p.id))} className={`shrink-0 w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-all ${isDark ? 'text-zinc-600 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-300 hover:text-red-500 hover:bg-red-50'}`}>
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={() => onChange([...pairs, mkKV()])} className={`mt-2 flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-md w-fit ${isDark ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}>
        <Plus size={11} /><span>添加行</span>
      </button>
    </div>
  )
}

// ── StatusBadge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, statusText }: { status: number; statusText: string }) {
  const [cls, dot] = status === 0 ? ['bg-zinc-800 text-zinc-300 border-zinc-700', 'bg-zinc-500']
    : status < 300 ? ['bg-emerald-500/15 text-emerald-400 border-emerald-500/30', 'bg-emerald-400']
    : status < 400 ? ['bg-amber-500/15 text-amber-400 border-amber-500/30', 'bg-amber-400']
    : status < 500 ? ['bg-orange-500/15 text-orange-400 border-orange-500/30', 'bg-orange-400']
    : ['bg-red-500/15 text-red-400 border-red-500/30', 'bg-red-400']
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {status === 0 ? 'ERROR' : `${status} ${statusText}`}
    </span>
  )
}

// ── JsonTree: 折叠展开 ─────────────────────────────────────────────────────
function JsonTreeValue({ data, isDark, keyword }: { data: unknown; isDark: boolean; keyword: string }) {
  if (data === null) return <span style={{ color: isDark ? '#71717a' : '#94a3b8' }}>null</span>
  if (data === undefined) return <span style={{ color: isDark ? '#71717a' : '#94a3b8' }}>undefined</span>
  if (typeof data === 'string') return <span style={{ color: isDark ? '#34d399' : '#059669' }}>"{highlightSearch(data, keyword, isDark)}"</span>
  if (typeof data === 'number') return <span style={{ color: isDark ? '#fbbf24' : '#d97706' }}>{String(data)}</span>
  if (typeof data === 'boolean') return <span style={{ color: isDark ? '#60a5fa' : '#2563eb' }}>{String(data)}</span>
  return <JsonTreeNode data={data} isDark={isDark} keyword={keyword} />
}
function JsonTreeNode({ data, isDark, keyword, defaultOpen = true }: { data: unknown; isDark: boolean; keyword: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  if (data === null || typeof data !== 'object') return <JsonTreeValue data={data} isDark={isDark} keyword={keyword} />
  const isArr = Array.isArray(data)
  const entries = isArr ? (data as unknown[]).map((v, i) => [String(i), v] as [string, unknown]) : Object.entries(data as Record<string, unknown>)
  if (entries.length === 0) return <span style={{ color: isDark ? '#71717a' : '#94a3b8' }}>{isArr ? '[]' : '{}'}</span>
  const braceColor = { color: isDark ? '#71717a' : '#94a3b8' }
  const keyColor = { color: isDark ? '#38bdf8' : '#0284c7' }
  return (
    <span>
      <span
        className="cursor-pointer select-none inline-flex items-center gap-0.5"
        style={braceColor}
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={11} className="inline shrink-0" /> : <ChevronRight size={11} className="inline shrink-0" />}
        {isArr ? '[' : '{'}
        {!open && <span className="opacity-60 ml-1">{entries.length} {isArr ? 'items' : 'keys'}</span>}
        {!open && (isArr ? ']' : '}')}
      </span>
      {open && (
        <div style={{ paddingLeft: 18, borderLeft: `1px dashed ${isDark ? '#3f3f46' : '#e5e7eb'}`, marginLeft: 5 }}>
          {entries.map(([k, v], i) => (
            <div key={k}>
              {!isArr && <><span style={keyColor}>"{highlightSearch(k, keyword, isDark)}"</span><span style={braceColor}>: </span></>}
              <JsonTreeNode data={v} isDark={isDark} keyword={keyword} defaultOpen={false} />
              {i < entries.length - 1 && <span style={braceColor}>,</span>}
            </div>
          ))}
        </div>
      )}
      {open && <span style={braceColor}>{isArr ? ']' : '}'}</span>}
    </span>
  )
}

// ── Modal helper ────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children, isDark, wide = false }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; isDark: boolean; wide?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`${wide ? 'w-[720px]' : 'w-[520px]'} max-h-[80vh] rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`px-5 py-3.5 flex items-center justify-between border-b ${isDark ? 'border-zinc-800' : 'border-slate-200'}`}>
          <h3 className={`text-sm font-bold ${isDark ? 'text-zinc-100' : 'text-slate-900'}`}>{title}</h3>
          <button onClick={onClose} className={`w-7 h-7 rounded-lg flex items-center justify-center ${isDark ? 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

// ── Utility ─────────────────────────────────────────────────────────────────
function formatSize(b: number) { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB` }
function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  return s < 60 ? `${s}秒前` : s < 3600 ? `${Math.floor(s / 60)}分钟前` : s < 86400 ? `${Math.floor(s / 3600)}小时前` : `${Math.floor(s / 86400)}天前`
}
function guessFileName(url: string, ct: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    if (last && /\.\w+$/.test(last)) return last
  } catch { /* ignore */ }
  const ext = ct.includes('json') ? 'json' : ct.includes('xml') ? 'xml' : ct.includes('html') ? 'html' : 'txt'
  return `response_${Date.now()}.${ext}`
}

// ── Main component ───────────────────────────────────────────────────────────
export function AppRequest({ theme }: AppRequestProps) {
  const isDark = theme === 'dark'
  const [req, setReq] = useState<RequestState>(INIT_REQ)
  const [reqTab, setReqTab] = useState<ReqTab>('body')
  const [resTab, setResTab] = useState<ResTab>('body')
  const [resView, setResView] = useState<ResViewMode>('pretty')
  const [response, setResponse] = useState<ResponseState | null>(null)
  const [loading, setLoading] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)
  const [envOpen, setEnvOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState<'curl' | 'fetch' | 'axios' | null>(null)
  const [importCurlOpen, setImportCurlOpen] = useState(false)
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  const [envMgrOpen, setEnvMgrOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [formatError, setFormatError] = useState<string | null>(null)
  const [resSearch, setResSearch] = useState('')

  const [history, setHistory] = useState<HistoryEntry[]>(() => loadJson<HistoryEntry[]>(HISTORY_KEY, []))
  const [collections, setCollections] = useState<CollectionItem[]>(() => loadJson<CollectionItem[]>(COLLECTIONS_KEY, []))
  const [envs, setEnvs] = useState<Environment[]>(() => loadJson<Environment[]>(ENVS_KEY, []))
  const [activeEnvId, setActiveEnvId] = useState<string>(() => localStorage.getItem(ACTIVE_ENV_KEY) || '')
  const [historySearch, setHistorySearch] = useState('')
  const [importCurlText, setImportCurlText] = useState('')
  const [saveName, setSaveName] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const [, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 60000); return () => clearInterval(t) }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  const historyRef = useRef(history); historyRef.current = history

  const upd = <K extends keyof RequestState>(f: K, v: RequestState[K]) => setReq(prev => ({ ...prev, [f]: v }))

  // 环境变量
  const activeEnv = envs.find(e => e.id === activeEnvId) || null
  const envVars: Record<string, string> = activeEnv?.vars || {}

  const applyFormat = useCallback((field: 'bodyJson' | 'bodyXml' | 'bodyGql' | 'bodyGqlVars' | 'bodyRaw', type: 'json' | 'xml' | 'gql') => {
    setFormatError(null)
    const src = req[field] as string
    const { result, error } = type === 'json' ? tryFormatJson(src) : type === 'xml' ? tryFormatXml(src) : tryFormatGql(src)
    if (error) setFormatError(error)
    else upd(field, result)
  }, [req])

  const pushHistory = useCallback((r: RequestState, res: ResponseState | undefined) => {
    if (!r.url.trim()) return
    const entry: HistoryEntry = { id: Math.random().toString(36).slice(2), timestamp: Date.now(), method: r.method, url: r.url, req: { ...r }, response: res }
    const next = [entry, ...historyRef.current].slice(0, MAX_HISTORY)
    saveJson(HISTORY_KEY, next); setHistory(next)
  }, [])

  const sendRequest = useCallback(async () => {
    if (!req.url.trim()) return
    setLoading(true); setResponse(null); setResSearch('')
    const start = performance.now()
    try {
      const resolved = buildResolvedRequest(req, envVars)
      // binary body：主进程读取本地文件为 base64
      let bodyStr = resolved.body
      let bodyEncoding: 'text' | 'base64' | undefined = resolved.bodyEncoding
      if (req.bodyType === 'binary' && req.bodyBinary && req.method !== 'GET' && req.method !== 'HEAD') {
        bodyStr = await window.ipcRenderer.invoke('read-file-base64', { path: req.bodyBinary.path })
        bodyEncoding = 'base64'
        if (!hasHeader(resolved.headers, 'Content-Type')) resolved.headers['Content-Type'] = 'application/octet-stream'
      }
      const result = await window.ipcRenderer.invoke('http-request', {
        method: resolved.method, url: resolved.url, headers: resolved.headers,
        body: bodyStr, bodyEncoding,
        timeout: resolved.timeout, rejectUnauthorized: resolved.rejectUnauthorized,
      }) as { status: number; statusText: string; headers: Record<string, string>; body: string; bodyBase64?: string }
      const time = Math.round(performance.now() - start)
      const ct = result.headers['content-type'] ?? ''
      const formatted = autoFormatResponse(result.body, ct)
      const res: ResponseState = {
        status: result.status, statusText: result.statusText, time,
        size: new TextEncoder().encode(result.body).length,
        headers: result.headers, body: formatted, bodyBase64: result.bodyBase64, contentType: ct,
      }
      setResponse(res); setResTab('body'); setResView('pretty'); pushHistory(req, res)
    } catch (e) {
      const time = Math.round(performance.now() - start)
      const err: ResponseState = { status: 0, statusText: 'Error', time, size: 0, headers: {}, body: '', contentType: '', error: e instanceof Error ? e.message : String(e) }
      setResponse(err); pushHistory(req, err)
    } finally { setLoading(false) }
  }, [req, envVars, pushHistory])

  const copyResponse = () => {
    if (!response?.body) return
    navigator.clipboard.writeText(response.body); setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  const saveResponseToFile = async () => {
    if (!response) return
    const ct = response.contentType.toLowerCase()
    const isBinaryLike = ct.startsWith('image/') || ct.startsWith('audio/') || ct.startsWith('video/') || ct.includes('octet-stream') || ct.includes('pdf') || ct.includes('zip')
    await window.ipcRenderer.invoke('save-response-to-file', {
      defaultName: guessFileName(req.url, ct),
      content: isBinaryLike && response.bodyBase64 ? response.bodyBase64 : response.body,
      encoding: isBinaryLike && response.bodyBase64 ? 'base64' : 'utf-8',
    })
  }

  // 实时解析预览（用户粘贴即可看到识别结果）
  const importPreview = useMemo(() => {
    const t = importCurlText.trim()
    return t ? parseCurl(t) : null
  }, [importCurlText])

  const importCurl = () => {
    if (!importPreview) return
    setReq(prev => ({ ...prev, ...importPreview } as RequestState))
    setImportCurlText(''); setImportCurlOpen(false); setReqTab('body')
  }

  const doExport = (kind: 'curl' | 'fetch' | 'axios') => {
    const resolved = buildResolvedRequest(req, envVars)
    return kind === 'curl' ? generateCurl(resolved) : kind === 'fetch' ? generateFetch(resolved) : generateAxios(resolved)
  }

  const selectBinaryFile = async () => {
    const info = await window.ipcRenderer.invoke('select-upload-file') as BinaryFileInfo | null
    if (info) upd('bodyBinary', info)
  }

  const saveCollection = () => {
    const name = saveName.trim() || `Untitled ${collections.length + 1}`
    const item: CollectionItem = { id: Math.random().toString(36).slice(2), name, req: { ...req, name }, createdAt: Date.now() }
    const next = [item, ...collections]
    setCollections(next); saveJson(COLLECTIONS_KEY, next)
    setSaveOpen(false); setSaveName('')
  }

  // ── Style helpers ────────────────────────────────────────────────────────
  const bg0 = isDark ? 'bg-zinc-950' : 'bg-slate-100'
  const bg1 = isDark ? 'bg-zinc-900' : 'bg-white'
  const bg2 = isDark ? 'bg-zinc-800/60' : 'bg-slate-50'
  const border = isDark ? 'border-zinc-800' : 'border-slate-200'
  const muted = isDark ? 'text-zinc-500' : 'text-slate-400'
  const iconBtn = `w-8 h-8 rounded-lg flex items-center justify-center transition-all ${isDark ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`
  const tabBtn = (active: boolean) => `relative px-1 pb-2.5 pt-1 text-xs font-medium transition-colors ${active ? (isDark ? 'text-white' : 'text-slate-900') : (isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-700')}`
  const fmtBtn = `flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border font-medium transition-all ${isDark ? 'border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200 hover:bg-zinc-800' : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50'}`
  const inp = `px-2.5 py-1.5 text-xs rounded-md border font-mono outline-none transition-all ${isDark ? 'bg-zinc-900 border-zinc-700/60 text-zinc-200 placeholder-zinc-600 focus:border-blue-500/50' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-300 focus:border-blue-400'}`
  const mStyle = (isDark ? METHOD_DARK : METHOD_LIGHT)[req.method]

  const filteredHistory = historySearch.trim()
    ? history.filter(h => h.url.toLowerCase().includes(historySearch.toLowerCase()) || h.method.toLowerCase().includes(historySearch.toLowerCase()))
    : history

  const REQ_TABS: [ReqTab, string, React.ReactNode][] = [
    ['params', 'Params', null],
    ['body', 'Body', null],
    ['headers', 'Headers', null],
    ['auth', 'Auth', <KeyRound size={11} />],
    ['cookies', 'Cookies', <Cookie size={11} />],
    ['options', 'Options', <Settings size={11} />],
    ['history', '历史', <Clock size={11} />],
  ]

  return (
    <div className={`h-full flex flex-col ${bg0}`} onClick={() => { methodOpen && setMethodOpen(false); envOpen && setEnvOpen(false); exportOpen && setExportOpen(null) }}>

      {/* Top toolbar */}
      <div className={`px-4 py-2 border-b ${border} ${bg1} shrink-0 flex items-center gap-2`}>
        {/* Environment picker */}
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button onClick={() => setEnvOpen(o => !o)} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${isDark ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
            <Layers size={12} className="opacity-60" />
            <span className="truncate max-w-[140px]">{activeEnv ? activeEnv.name : '无环境'}</span>
            <ChevronsUpDown size={11} className="opacity-50" />
          </button>
          {envOpen && (
            <div className={`absolute top-full left-0 mt-1.5 rounded-xl border shadow-2xl z-40 min-w-[220px] overflow-hidden ${isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'}`}>
              <button onClick={() => { setActiveEnvId(''); localStorage.setItem(ACTIVE_ENV_KEY, ''); setEnvOpen(false) }} className={`w-full text-left text-xs px-3 py-2 ${!activeEnvId ? (isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-700') : (isDark ? 'hover:bg-zinc-800 text-zinc-300' : 'hover:bg-slate-50 text-slate-700')}`}>无环境</button>
              {envs.map(env => (
                <button key={env.id} onClick={() => { setActiveEnvId(env.id); localStorage.setItem(ACTIVE_ENV_KEY, env.id); setEnvOpen(false) }} className={`w-full text-left text-xs px-3 py-2 ${env.id === activeEnvId ? (isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-700') : (isDark ? 'hover:bg-zinc-800 text-zinc-300' : 'hover:bg-slate-50 text-slate-700')}`}>
                  {env.name} <span className={`text-[10px] ${muted}`}>· {Object.keys(env.vars).length} 个变量</span>
                </button>
              ))}
              <div className={`border-t ${border}`} />
              <button onClick={() => { setEnvMgrOpen(true); setEnvOpen(false) }} className={`w-full text-left text-xs px-3 py-2 flex items-center gap-1.5 ${isDark ? 'hover:bg-zinc-800 text-blue-400' : 'hover:bg-slate-50 text-blue-600'}`}>
                <Settings size={11} />管理环境
              </button>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <button title="收藏（保存当前请求）" onClick={() => setSaveOpen(true)} className={iconBtn}><Star size={15} /></button>
        <button title="打开集合" onClick={() => setCollectionsOpen(true)} className={iconBtn}><ListTree size={15} /></button>
        <button title="导入 cURL" onClick={() => setImportCurlOpen(true)} className={iconBtn}><Download size={15} /></button>
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button title="导出为 cURL / fetch / axios" onClick={() => setExportOpen(o => o ? null : 'curl')} className={iconBtn}><Code2 size={15} /></button>
          {exportOpen && (
            <div className={`absolute top-full right-0 mt-1.5 rounded-xl border shadow-2xl z-40 min-w-[140px] overflow-hidden ${isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-slate-200'}`}>
              {(['curl', 'fetch', 'axios'] as const).map(k => (
                <button key={k} onClick={() => setExportOpen(k)} className={`w-full text-left text-xs px-3 py-2 ${isDark ? 'hover:bg-zinc-800 text-zinc-300' : 'hover:bg-slate-50 text-slate-700'}`}>{k}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* URL Bar */}
      <div className={`px-4 py-3 border-b ${border} ${bg1} shrink-0`}>
        <div className={`flex items-center gap-2 rounded-xl border p-1.5 transition-all ${isDark ? 'bg-zinc-800/70 border-zinc-700/60 focus-within:border-blue-500/40 focus-within:bg-zinc-800' : 'bg-slate-50 border-slate-200 focus-within:border-blue-400/60 focus-within:shadow-sm'}`}>
          <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
            <button onClick={() => setMethodOpen(o => !o)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${mStyle.bg} ${mStyle.border} ${mStyle.text}`}>
              {req.method}<ChevronDown size={11} className={`transition-transform opacity-60 ${methodOpen ? 'rotate-180' : ''}`} />
            </button>
            {methodOpen && (
              <div className={`absolute top-full left-0 mt-1.5 rounded-xl border shadow-2xl z-50 overflow-hidden min-w-[120px] ${isDark ? 'bg-zinc-900 border-zinc-700/80' : 'bg-white border-slate-200'}`}>
                {METHODS.map(m => { const ms = (isDark ? METHOD_DARK : METHOD_LIGHT)[m]; return (
                  <button key={m} onClick={() => { upd('method', m); setMethodOpen(false) }} className={`w-full px-4 py-2 text-left text-xs font-bold transition-colors ${ms.text} ${req.method === m ? (isDark ? 'bg-zinc-800' : 'bg-slate-50') : (isDark ? 'hover:bg-zinc-800/60' : 'hover:bg-slate-50')}`}>{m}</button>
                )})}
              </div>
            )}
          </div>
          <div className={`w-px h-5 shrink-0 ${isDark ? 'bg-zinc-700' : 'bg-slate-200'}`} />
          <div className="flex-1 flex items-center gap-2">
            <Globe size={13} className={`${muted} shrink-0`} />
            <input
              value={req.url}
              onChange={e => upd('url', e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) sendRequest() }}
              onPaste={e => {
                // 支持直接在 URL 框里粘贴 cURL 命令自动识别并填充整个请求
                const text = e.clipboardData.getData('text')
                if (!/^\s*curl[\s\\\n]/i.test(text)) return
                const parsed = parseCurl(text)
                if (parsed && parsed.url) {
                  e.preventDefault()
                  setReq(prev => ({ ...prev, ...parsed } as RequestState))
                  setReqTab('body')
                  setToast(`已解析 cURL：${parsed.method} · ${(parsed.headers?.filter(h => h.key).length || 0)} headers · ${(parsed.cookies?.length || 0)} cookies${parsed.bodyType && parsed.bodyType !== 'none' ? ` · ${parsed.bodyType}` : ''}`)
                }
              }}
              placeholder="https://api.example.com/endpoint （支持 {{var}} · 可直接粘贴 cURL 自动识别）"
              className={`flex-1 bg-transparent text-sm font-mono outline-none ${isDark ? 'text-zinc-100 placeholder-zinc-600' : 'text-slate-800 placeholder-slate-400'}`}
            />
          </div>
          <button onClick={sendRequest} disabled={loading || !req.url.trim()} className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-all shrink-0 shadow-lg shadow-blue-500/25">
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}发送
          </button>
        </div>
      </div>

      {/* Split */}
      <div className="flex-1 flex min-h-0">

        {/* LEFT */}
        <div className={`w-[48%] flex flex-col min-h-0 border-r ${border}`}>
          {/* Tabs */}
          <div className={`flex items-end gap-4 px-4 border-b ${border} ${bg1} shrink-0 overflow-x-auto`}>
            {REQ_TABS.map(([t, label, icon]) => (
              <button key={t} onClick={() => setReqTab(t)} className={tabBtn(reqTab === t) + ' shrink-0'}>
                <span className="flex items-center gap-1">{icon}{label}{t === 'history' && history.length > 0 && <span className={`ml-0.5 text-[10px] px-1 rounded-full ${isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-slate-100 text-slate-500'}`}>{history.length}</span>}</span>
                {reqTab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-blue-500" />}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className={`flex-1 flex flex-col min-h-0 ${bg1}`}>

            {/* Params */}
            {reqTab === 'params' && (
              <div className="flex-1 overflow-y-auto p-4">
                <KVEditor pairs={req.params} onChange={v => upd('params', v)} isDark={isDark} keyPh="参数名" valPh="参数值" />
                <div className={`mt-3 text-[10px] ${muted}`}>说明：勾选启用的参数会在发送前自动附加到 URL；支持 {'{{var}}'} 变量插值。</div>
              </div>
            )}

            {/* Headers */}
            {reqTab === 'headers' && (
              <div className="flex-1 overflow-y-auto p-4">
                <KVEditor pairs={req.headers} onChange={v => upd('headers', v)} isDark={isDark} keyPh="Header 名称" valPh="Header 值" keyList={COMMON_HEADER_KEYS} />
              </div>
            )}

            {/* Cookies */}
            {reqTab === 'cookies' && (
              <div className="flex-1 overflow-y-auto p-4">
                <KVEditor pairs={req.cookies} onChange={v => upd('cookies', v)} isDark={isDark} keyPh="Cookie 名" valPh="Cookie 值" />
                <div className={`mt-3 text-[10px] ${muted}`}>说明：所有启用的 Cookies 会合成为一个 <code>Cookie</code> 请求头发送。</div>
              </div>
            )}

            {/* Auth */}
            {reqTab === 'auth' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                  <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-2 ${muted}`}>认证类型</label>
                  <select value={req.auth.type} onChange={e => upd('auth', { ...req.auth, type: e.target.value as AuthType })} className={inp + ' w-full'}>
                    <option value="none">No Auth</option>
                    <option value="basic">Basic Auth</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="apikey">API Key</option>
                  </select>
                </div>
                {req.auth.type === 'basic' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${muted}`}>用户名</label>
                      <input value={req.auth.basic.username} onChange={e => upd('auth', { ...req.auth, basic: { ...req.auth.basic, username: e.target.value } })} className={inp + ' w-full'} placeholder="username" />
                    </div>
                    <div><label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${muted}`}>密码</label>
                      <input type="password" value={req.auth.basic.password} onChange={e => upd('auth', { ...req.auth, basic: { ...req.auth.basic, password: e.target.value } })} className={inp + ' w-full'} placeholder="password" />
                    </div>
                    <div className={`col-span-2 text-[10px] ${muted}`}>将自动生成 <code>Authorization: Basic base64(user:pass)</code></div>
                  </div>
                )}
                {req.auth.type === 'bearer' && (
                  <div>
                    <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${muted}`}>Token</label>
                    <input value={req.auth.bearer.token} onChange={e => upd('auth', { ...req.auth, bearer: { token: e.target.value } })} className={inp + ' w-full'} placeholder="eyJhbGci..." />
                    <div className={`mt-2 text-[10px] ${muted}`}>将自动生成 <code>Authorization: Bearer &lt;token&gt;</code></div>
                  </div>
                )}
                {req.auth.type === 'apikey' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${muted}`}>Key</label>
                        <input value={req.auth.apikey.key} onChange={e => upd('auth', { ...req.auth, apikey: { ...req.auth.apikey, key: e.target.value } })} className={inp + ' w-full'} placeholder="X-API-Key" />
                      </div>
                      <div><label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${muted}`}>Value</label>
                        <input value={req.auth.apikey.value} onChange={e => upd('auth', { ...req.auth, apikey: { ...req.auth.apikey, value: e.target.value } })} className={inp + ' w-full'} placeholder="your-api-key" />
                      </div>
                    </div>
                    <div><label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${muted}`}>添加到</label>
                      <select value={req.auth.apikey.in} onChange={e => upd('auth', { ...req.auth, apikey: { ...req.auth.apikey, in: e.target.value as 'header' | 'query' } })} className={inp + ' w-full'}>
                        <option value="header">请求头 (Header)</option>
                        <option value="query">查询参数 (Query)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Options */}
            {reqTab === 'options' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                  <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${muted}`}>超时时间（毫秒，0 = 无超时）</label>
                  <input type="number" min={0} step={1000} value={req.options.timeout} onChange={e => upd('options', { ...req.options, timeout: parseInt(e.target.value || '0', 10) })} className={inp + ' w-full'} />
                </div>
                <div className="flex items-start gap-3">
                  <input id="ssl" type="checkbox" checked={!req.options.rejectUnauthorized} onChange={e => upd('options', { ...req.options, rejectUnauthorized: !e.target.checked })} className="mt-0.5 w-4 h-4 accent-blue-500 cursor-pointer" />
                  <label htmlFor="ssl" className="cursor-pointer">
                    <div className={`text-xs font-medium ${isDark ? 'text-zinc-200' : 'text-slate-800'}`}>忽略 SSL 证书错误</div>
                    <div className={`text-[10px] mt-0.5 ${muted}`}>调试自签名 / 内网环境使用；生产环境建议关闭</div>
                  </label>
                </div>
              </div>
            )}

            {/* Body */}
            {reqTab === 'body' && (
              <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
                {/* Type selector + format button */}
                <div className="flex items-center justify-between gap-2 shrink-0">
                  <div className={`flex items-center gap-1 flex-1 p-1 rounded-xl overflow-x-auto ${isDark ? 'bg-zinc-800/60' : 'bg-slate-100'}`}>
                    {(['none', 'form-data', 'urlencoded', 'json', 'xml', 'graphql', 'raw', 'binary'] as BodyType[]).map(b => (
                      <button key={b} onClick={() => { upd('bodyType', b); setFormatError(null) }} className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all shrink-0 ${req.bodyType === b ? (isDark ? 'bg-zinc-700 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm') : (isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-700')}`}>
                        {b === 'none' ? '无' : b === 'urlencoded' ? 'x-www-form-urlencoded' : b}
                      </button>
                    ))}
                  </div>
                  {(req.bodyType === 'json' || req.bodyType === 'xml') && (
                    <button onClick={() => applyFormat(req.bodyType === 'json' ? 'bodyJson' : 'bodyXml', req.bodyType as 'json' | 'xml')} className={fmtBtn}><WrapText size={11} />格式化</button>
                  )}
                </div>

                {formatError && (
                  <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border shrink-0 ${isDark ? 'bg-red-950/20 border-red-900/30 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
                    <AlertCircle size={12} className="shrink-0 mt-0.5" /><span className="font-mono">{formatError}</span>
                  </div>
                )}

                {req.bodyType === 'none' && (
                  <div className={`flex-1 flex items-center justify-center rounded-xl border border-dashed ${isDark ? 'border-zinc-800 text-zinc-600' : 'border-slate-200 text-slate-400'}`}>
                    <p className="text-xs">该请求没有请求体</p>
                  </div>
                )}
                {req.bodyType === 'form-data' && (
                  <div className="flex-1 overflow-y-auto">
                    <KVEditor pairs={req.formData} onChange={v => upd('formData', v)} isDark={isDark} keyPh="字段名" valPh="字段值" />
                  </div>
                )}
                {req.bodyType === 'urlencoded' && (
                  <div className="flex-1 overflow-y-auto">
                    <KVEditor pairs={req.urlEncoded} onChange={v => upd('urlEncoded', v)} isDark={isDark} keyPh="字段名" valPh="字段值" />
                    <div className={`mt-3 text-[10px] ${muted}`}>说明：将以 <code>application/x-www-form-urlencoded</code> 格式编码发送。</div>
                  </div>
                )}
                {req.bodyType === 'raw' && (
                  <textarea value={req.bodyRaw} onChange={e => { upd('bodyRaw', e.target.value); setFormatError(null) }} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendRequest() } }}
                    placeholder="纯文本 body..." spellCheck={false}
                    className={`flex-1 min-h-0 w-full rounded-xl border font-mono text-xs p-3 outline-none resize-none ${isDark ? 'bg-zinc-900 border-zinc-700/60 text-zinc-200 placeholder-zinc-600 focus:border-blue-500/50' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-300 focus:border-blue-400'}`} />
                )}
                {req.bodyType === 'binary' && (
                  <div className={`flex-1 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed ${isDark ? 'border-zinc-800 text-zinc-500' : 'border-slate-200 text-slate-400'}`}>
                    {req.bodyBinary ? (
                      <div className="text-center">
                        <FileText size={30} className="mx-auto mb-2" />
                        <div className={`text-xs font-medium ${isDark ? 'text-zinc-200' : 'text-slate-800'}`}>{req.bodyBinary.name}</div>
                        <div className={`text-[10px] mt-1 ${muted}`}>{formatSize(req.bodyBinary.size)}</div>
                        <div className={`text-[10px] mt-1 ${muted}`}>{req.bodyBinary.path}</div>
                        <div className="flex items-center gap-2 mt-3 justify-center">
                          <button onClick={selectBinaryFile} className={fmtBtn}><Upload size={11} />更换文件</button>
                          <button onClick={() => upd('bodyBinary', undefined)} className={fmtBtn}><X size={11} />清除</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Upload size={30} />
                        <button onClick={selectBinaryFile} className={`px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all`}>选择文件</button>
                        <p className="text-[11px]">文件将作为 request body 直接上传</p>
                      </>
                    )}
                  </div>
                )}
                {req.bodyType === 'json' && (
                  <HighlightEditor value={req.bodyJson} onChange={v => { upd('bodyJson', v); setFormatError(null) }} language="json" isDark={isDark} fill onSubmit={sendRequest} />
                )}
                {req.bodyType === 'xml' && (
                  <HighlightEditor value={req.bodyXml} onChange={v => { upd('bodyXml', v); setFormatError(null) }} language="xml" isDark={isDark} fill onSubmit={sendRequest} />
                )}
                {req.bodyType === 'graphql' && (
                  <div className="flex-1 flex flex-col min-h-0 gap-3">
                    <div className="flex-1 flex flex-col min-h-0">
                      <div className="flex items-center justify-between mb-2 shrink-0">
                        <span className={`text-[11px] font-semibold uppercase tracking-wider ${muted}`}>Query</span>
                        <button onClick={() => applyFormat('bodyGql', 'gql')} className={fmtBtn}><WrapText size={11} />格式化</button>
                      </div>
                      <HighlightEditor value={req.bodyGql} onChange={v => { upd('bodyGql', v); setFormatError(null) }} language="gql" isDark={isDark} fill placeholder="{ user(id: 1) { name email } }" onSubmit={sendRequest} />
                    </div>
                    <div className="shrink-0">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[11px] font-semibold uppercase tracking-wider ${muted}`}>Variables (JSON)</span>
                        <button onClick={() => applyFormat('bodyGqlVars', 'json')} className={fmtBtn}><WrapText size={11} />格式化</button>
                      </div>
                      <HighlightEditor value={req.bodyGqlVars} onChange={v => { upd('bodyGqlVars', v); setFormatError(null) }} language="json" isDark={isDark} minHeight={120} placeholder='{ "id": 1 }' onSubmit={sendRequest} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* History */}
            {reqTab === 'history' && (
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${isDark ? 'bg-zinc-800/60 border-zinc-700/60' : 'bg-slate-50 border-slate-200'}`}>
                  <Search size={13} className={muted} />
                  <input value={historySearch} onChange={e => setHistorySearch(e.target.value)} placeholder="搜索 URL 或方法..."
                    className={`flex-1 bg-transparent text-xs outline-none font-mono ${isDark ? 'text-zinc-200 placeholder-zinc-600' : 'text-slate-800 placeholder-slate-400'}`} />
                  {historySearch && <button onClick={() => setHistorySearch('')} className={`shrink-0 ${muted}`}><X size={12} /></button>}
                </div>

                {history.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] ${muted}`}>{historySearch ? `${filteredHistory.length} / ${history.length} 条` : `${history.length} 条记录`}</span>
                    <button onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]) }} className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border transition-all ${isDark ? 'border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-500/40' : 'border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-300'}`}>
                      <Trash size={10} />清空
                    </button>
                  </div>
                )}

                {history.length === 0 && (
                  <div className={`flex flex-col items-center justify-center py-12 gap-3 rounded-xl border border-dashed ${isDark ? 'border-zinc-800 text-zinc-600' : 'border-slate-200 text-slate-400'}`}>
                    <Clock size={28} strokeWidth={1.5} /><p className="text-xs">暂无历史记录</p>
                    <p className={`text-[11px] ${muted}`}>发送请求后自动保存</p>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  {filteredHistory.map(entry => {
                    const ms = (isDark ? METHOD_DARK : METHOD_LIGHT)[entry.method]
                    return (
                      <button key={entry.id} onClick={() => { setReq(entry.req); if (entry.response) setResponse(entry.response); setReqTab('body'); setFormatError(null) }}
                        className={`group w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${isDark ? 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50' : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'}`}>
                        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${ms.bg} ${ms.border} ${ms.text}`}>{entry.method}</span>
                        <span className={`flex-1 text-xs font-mono truncate ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>{entry.url}</span>
                        {entry.response && entry.response.status > 0 && (
                          <span className={`shrink-0 text-[10px] font-bold ${entry.response.status < 400 ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : (isDark ? 'text-red-400' : 'text-red-600')}`}>{entry.response.status}</span>
                        )}
                        <span className={`shrink-0 text-[11px] ${muted}`}>{timeAgo(entry.timestamp)}</span>
                        <button onClick={e => { e.stopPropagation(); const next = historyRef.current.filter(h => h.id !== entry.id); saveJson(HISTORY_KEY, next); setHistory(next) }}
                          className={`shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 ${isDark ? 'text-zinc-600 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-300 hover:text-red-400 hover:bg-red-50'}`}>
                          <Trash2 size={10} />
                        </button>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* RIGHT: Response */}
        <div className={`flex-1 flex flex-col min-h-0 ${bg2}`}>
          <div className={`flex items-end justify-between px-4 border-b ${border} ${bg1} shrink-0`}>
            <div className="flex items-end gap-5">
              {([['body', '响应体'], ['headers', '响应头']] as [ResTab, string][]).map(([t, label]) => (
                <button key={t} onClick={() => setResTab(t)} className={tabBtn(resTab === t)}>
                  {label}{resTab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-blue-500" />}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 pb-2">
              {response && !response.error && (
                <><StatusBadge status={response.status} statusText={response.statusText} />
                <span className={`text-[11px] font-mono tabular-nums ${muted}`}>{response.time} ms</span>
                <span className={`text-[11px] font-mono tabular-nums ${muted}`}>{formatSize(response.size)}</span></>
              )}
              {response?.body && response.contentType.includes('json') && resTab === 'body' && !response.error && (
                <div className={`flex items-center gap-0.5 p-0.5 rounded-lg border text-[10px] font-medium ${isDark ? 'border-zinc-700 bg-zinc-800' : 'border-slate-200 bg-slate-50'}`}>
                  {(['pretty', 'tree', 'raw'] as ResViewMode[]).map(m => (
                    <button key={m} onClick={() => setResView(m)} className={`px-2 py-0.5 rounded ${resView === m ? (isDark ? 'bg-zinc-700 text-white' : 'bg-white text-slate-900 shadow-sm') : (isDark ? 'text-zinc-500' : 'text-slate-400')}`}>{m === 'pretty' ? '预览' : m === 'tree' ? '树形' : 'Raw'}</button>
                  ))}
                </div>
              )}
              <button onClick={saveResponseToFile} disabled={!response?.body} title="保存到文件"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all disabled:opacity-30 ${isDark ? 'border-zinc-700 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800' : 'border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}>
                <Save size={11} />
              </button>
              <button onClick={copyResponse} disabled={!response?.body} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all disabled:opacity-30 ${copied ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : (isDark ? 'border-zinc-700 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800' : 'border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-50')}`}>
                {copied ? <Check size={11} /> : <Copy size={11} />}{copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            {!response && !loading && (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 select-none">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${isDark ? 'bg-zinc-800/60' : 'bg-slate-100'}`}><Send size={26} strokeWidth={1.5} className={muted} /></div>
                <div className="text-center">
                  <p className={`text-sm font-semibold ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>等待请求</p>
                  <p className={`text-xs mt-1 ${muted}`}>点击发送按钮查看响应结果</p>
                </div>
              </div>
            )}
            {loading && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-zinc-800' : 'bg-slate-100'}`}><RefreshCw size={18} className="animate-spin text-blue-500" /></div>
                <p className={`text-xs ${muted}`}>正在请求...</p>
              </div>
            )}
            {response && !loading && (
              <>
                {response.error && (
                  <div className="p-4 shrink-0">
                    <div className={`p-4 rounded-xl border flex items-start gap-3 ${isDark ? 'bg-red-950/20 border-red-900/30' : 'bg-red-50 border-red-200'}`}>
                      <AlertCircle size={15} className={`shrink-0 mt-0.5 ${isDark ? 'text-red-400' : 'text-red-500'}`} />
                      <div><p className={`text-xs font-semibold mb-1 ${isDark ? 'text-red-300' : 'text-red-700'}`}>请求失败</p><p className={`text-xs font-mono break-all ${isDark ? 'text-red-400/80' : 'text-red-600'}`}>{response.error}</p></div>
                    </div>
                  </div>
                )}
                {resTab === 'body' && !response.error && (
                  <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
                    {/* Response search */}
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border shrink-0 ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'}`}>
                      <Search size={12} className={muted} />
                      <input value={resSearch} onChange={e => setResSearch(e.target.value)} placeholder="在响应中搜索..."
                        className={`flex-1 bg-transparent text-xs outline-none font-mono ${isDark ? 'text-zinc-200 placeholder-zinc-600' : 'text-slate-800 placeholder-slate-400'}`} />
                      {resSearch && <button onClick={() => setResSearch('')} className={muted}><X size={12} /></button>}
                    </div>
                    <div className={`flex-1 flex flex-col min-h-0 rounded-xl border overflow-hidden ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'}`}>
                      <pre tabIndex={0}
                        onKeyDown={e => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
                            e.preventDefault(); const range = document.createRange()
                            range.selectNodeContents(e.currentTarget); const sel = window.getSelection()
                            sel?.removeAllRanges(); sel?.addRange(range)
                          }
                        }}
                        className="flex-1 overflow-auto p-4 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed outline-none">
                        {response.body === '' ? (
                          <span className={muted}>(空响应体)</span>
                        ) : resView === 'tree' && response.contentType.includes('json') ? (
                          (() => { try { return <JsonTreeNode data={JSON.parse(response.body)} isDark={isDark} keyword={resSearch} /> } catch { return highlightJson(response.body, isDark) } })()
                        ) : resView === 'raw' ? (
                          <span style={{ color: isDark ? '#d4d4d8' : '#475569' }}>{highlightSearch(response.body, resSearch, isDark)}</span>
                        ) : resSearch ? (
                          <span style={{ color: isDark ? '#d4d4d8' : '#475569' }}>{highlightSearch(response.body, resSearch, isDark)}</span>
                        ) : response.contentType.includes('json') ? (
                          highlightJson(response.body, isDark)
                        ) : response.contentType.includes('xml') || response.contentType.includes('html') ? (
                          highlightXml(response.body, isDark)
                        ) : (
                          <span style={{ color: isDark ? '#d4d4d8' : '#475569' }}>{response.body}</span>
                        )}
                      </pre>
                    </div>
                  </div>
                )}
                {resTab === 'headers' && (
                  <div className="flex-1 overflow-auto p-4">
                    <div className={`rounded-xl border overflow-hidden ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'}`}>
                      <table className="w-full text-xs">
                        <thead><tr className={`border-b ${isDark ? 'border-zinc-800 bg-zinc-800/40' : 'border-slate-100 bg-slate-50'}`}>
                          <th className={`text-left px-4 py-2.5 font-semibold uppercase tracking-wider text-[10px] w-[38%] ${muted}`}>Header</th>
                          <th className={`text-left px-4 py-2.5 font-semibold uppercase tracking-wider text-[10px] ${muted}`}>Value</th>
                        </tr></thead>
                        <tbody>{Object.entries(response.headers).map(([k, v]) => (
                          <tr key={k} className={`border-t transition-colors ${isDark ? 'border-zinc-800 hover:bg-zinc-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                            <td className={`px-4 py-2.5 text-[11px] font-mono ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>{k}</td>
                            <td className={`px-4 py-2.5 text-[11px] font-mono break-all ${isDark ? 'text-zinc-400' : 'text-slate-600'}`}>{v}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Import cURL Modal */}
      <Modal open={importCurlOpen} onClose={() => setImportCurlOpen(false)} title="导入 cURL" isDark={isDark} wide>
        <div className="space-y-3">
          <p className={`text-xs ${muted}`}>
            粘贴 cURL 命令后<b>自动实时解析预览</b>；确认无误后点「应用到请求」。
            支持 Chrome/Firefox DevTools 「Copy as cURL (bash)」输出格式。
          </p>
          <textarea
            value={importCurlText}
            onChange={e => setImportCurlText(e.target.value)}
            onPaste={e => {
              // 粘贴时确保内容在下一个 tick 触发解析（React 已自动处理，但显式保险）
              setTimeout(() => setImportCurlText((e.target as HTMLTextAreaElement).value), 0)
            }}
            rows={10}
            autoFocus
            placeholder="curl -X POST 'https://api.example.com' -H 'Content-Type: application/json' -d '{...}'"
            className={`w-full rounded-lg border font-mono text-xs p-3 outline-none resize-none ${isDark ? 'bg-zinc-950 border-zinc-800 text-zinc-200 placeholder-zinc-600' : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400'}`}
          />

          {/* 实时解析预览 */}
          {importCurlText.trim() && (importPreview && importPreview.url ? (
            <div className={`text-xs p-3 rounded-lg border space-y-1 ${isDark ? 'bg-emerald-950/20 border-emerald-900/40 text-zinc-300' : 'bg-emerald-50 border-emerald-200 text-slate-700'}`}>
              <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>✓ 已识别</div>
              <div><span className="opacity-60">Method:</span> <span className="font-bold ml-1">{importPreview.method}</span></div>
              <div><span className="opacity-60">URL:</span> <span className="font-mono break-all ml-1">{importPreview.url}</span></div>
              {(importPreview.params?.filter(p => p.key).length || 0) > 0 && (
                <div><span className="opacity-60">Query Params:</span> <span className="ml-1">{importPreview.params!.filter(p => p.key).length} 个</span></div>
              )}
              {(importPreview.headers?.filter(h => h.key).length || 0) > 0 && (
                <div><span className="opacity-60">Headers:</span> <span className="ml-1">{importPreview.headers!.filter(h => h.key).length} 个</span></div>
              )}
              {importPreview.bodyType && importPreview.bodyType !== 'none' && (
                <div><span className="opacity-60">Body:</span> <span className="font-mono ml-1">{importPreview.bodyType}</span></div>
              )}
              {importPreview.auth && importPreview.auth.type !== 'none' && (
                <div><span className="opacity-60">Auth:</span> <span className="font-mono ml-1">{importPreview.auth.type}</span></div>
              )}
              {importPreview.options?.rejectUnauthorized === false && (
                <div className={isDark ? 'text-amber-400' : 'text-amber-600'}>⚠ 忽略 SSL 证书验证</div>
              )}
              {importPreview.options && importPreview.options.timeout > 0 && importPreview.options.timeout !== INIT_OPTIONS.timeout && (
                <div><span className="opacity-60">Timeout:</span> <span className="ml-1">{importPreview.options.timeout} ms</span></div>
              )}
            </div>
          ) : (
            <div className={`text-xs p-3 rounded-lg border ${isDark ? 'bg-red-950/20 border-red-900/40 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
              ⚠ 无法识别 URL。请检查是否是合法的 cURL 命令（不支持 PowerShell 或 CMD 格式）
            </div>
          ))}

          <div className="flex justify-end gap-2">
            <button onClick={() => setImportCurlOpen(false)} className={`px-3 py-1.5 text-xs rounded-lg ${isDark ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}>取消</button>
            <button onClick={importCurl} disabled={!importPreview || !importPreview.url} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed">应用到请求</button>
          </div>
        </div>
      </Modal>

      {/* Export Code Modal */}
      <Modal open={exportOpen === 'curl' || exportOpen === 'fetch' || exportOpen === 'axios'} onClose={() => setExportOpen(null)} title={`导出为 ${exportOpen}`} isDark={isDark} wide>
        {exportOpen && (
          <div className="space-y-3">
            <div className={`flex items-center gap-1 p-1 rounded-lg w-fit ${isDark ? 'bg-zinc-800' : 'bg-slate-100'}`}>
              {(['curl', 'fetch', 'axios'] as const).map(k => (
                <button key={k} onClick={() => setExportOpen(k)} className={`px-3 py-1 text-xs rounded ${exportOpen === k ? (isDark ? 'bg-zinc-700 text-white' : 'bg-white text-slate-900 shadow-sm') : (isDark ? 'text-zinc-400' : 'text-slate-500')}`}>{k}</button>
              ))}
            </div>
            <pre className={`p-3 rounded-lg text-xs font-mono overflow-auto max-h-[400px] ${isDark ? 'bg-zinc-950 text-zinc-200' : 'bg-slate-50 text-slate-800'}`}>{doExport(exportOpen)}</pre>
            <div className="flex justify-end">
              <button onClick={() => { navigator.clipboard.writeText(doExport(exportOpen)); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg ${copied ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
                {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Save (Collections) Modal */}
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="保存到集合" isDark={isDark}>
        <div className="space-y-3">
          <label className={`block text-xs font-semibold ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>命名</label>
          <input value={saveName} onChange={e => setSaveName(e.target.value)} autoFocus placeholder="例如：登录接口" className={inp + ' w-full'} />
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setSaveOpen(false)} className={`px-3 py-1.5 text-xs rounded-lg ${isDark ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}>取消</button>
            <button onClick={saveCollection} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white">保存</button>
          </div>
        </div>
      </Modal>

      {/* Collections Modal */}
      <Modal open={collectionsOpen} onClose={() => setCollectionsOpen(false)} title={`集合（${collections.length}）`} isDark={isDark} wide>
        {collections.length === 0 ? (
          <div className={`text-center py-8 ${muted}`}>
            <ListTree size={28} className="mx-auto mb-2 opacity-50" />
            <p className="text-xs">暂无收藏。点击顶部 ⭐ 保存当前请求。</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {collections.map(c => {
              const ms = (isDark ? METHOD_DARK : METHOD_LIGHT)[c.req.method]
              return (
                <div key={c.id} className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg border ${isDark ? 'border-zinc-800 hover:bg-zinc-800/50' : 'border-slate-100 hover:bg-slate-50'}`}>
                  <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${ms.bg} ${ms.border} ${ms.text}`}>{c.req.method}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-semibold truncate ${isDark ? 'text-zinc-200' : 'text-slate-800'}`}>{c.name}</div>
                    <div className={`text-[11px] font-mono truncate ${muted}`}>{c.req.url}</div>
                  </div>
                  <button onClick={() => { setReq(c.req); setCollectionsOpen(false); setReqTab('body') }}
                    className={`shrink-0 px-3 py-1 text-[11px] font-semibold rounded ${isDark ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>加载</button>
                  <button onClick={() => { const next = collections.filter(x => x.id !== c.id); setCollections(next); saveJson(COLLECTIONS_KEY, next) }}
                    className={`shrink-0 w-7 h-7 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 ${isDark ? 'text-zinc-500 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}`}>
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      {/* Environments Manager Modal */}
      <Modal open={envMgrOpen} onClose={() => setEnvMgrOpen(false)} title="管理环境" isDark={isDark} wide>
        <EnvManager envs={envs} setEnvs={(next) => { setEnvs(next); saveJson(ENVS_KEY, next) }} activeEnvId={activeEnvId} setActiveEnvId={(id) => { setActiveEnvId(id); localStorage.setItem(ACTIVE_ENV_KEY, id) }} isDark={isDark} />
      </Modal>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl shadow-2xl border max-w-md animate-in slide-in-from-bottom-4 fade-in duration-200 ${isDark ? 'bg-emerald-950/90 border-emerald-800 text-emerald-300' : 'bg-white border-emerald-200 text-emerald-700'}`}>
          <div className="flex items-center gap-2 text-xs font-medium">
            <Check size={14} className={isDark ? 'text-emerald-400' : 'text-emerald-600'} />
            <span>{toast}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Environment Manager (nested) ────────────────────────────────────────────
function EnvManager({ envs, setEnvs, activeEnvId, setActiveEnvId, isDark }: {
  envs: Environment[]; setEnvs: (next: Environment[]) => void
  activeEnvId: string; setActiveEnvId: (id: string) => void
  isDark: boolean
}) {
  const [sel, setSel] = useState<string>(envs[0]?.id || '')
  const cur = envs.find(e => e.id === sel)
  const inp = `px-2.5 py-1.5 text-xs rounded-md border font-mono outline-none ${isDark ? 'bg-zinc-900 border-zinc-700/60 text-zinc-200 placeholder-zinc-600 focus:border-blue-500/50' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-300 focus:border-blue-400'}`
  const muted = isDark ? 'text-zinc-500' : 'text-slate-400'

  const addEnv = () => {
    const env: Environment = { id: Math.random().toString(36).slice(2), name: `Env ${envs.length + 1}`, vars: {} }
    const next = [...envs, env]
    setEnvs(next); setSel(env.id)
  }
  const delEnv = (id: string) => {
    const next = envs.filter(e => e.id !== id)
    setEnvs(next); if (activeEnvId === id) setActiveEnvId('')
    if (sel === id) setSel(next[0]?.id || '')
  }
  const renameEnv = (id: string, name: string) => setEnvs(envs.map(e => e.id === id ? { ...e, name } : e))
  const updVar = (id: string, oldKey: string, newKey: string, newVal: string) => {
    setEnvs(envs.map(e => {
      if (e.id !== id) return e
      const vars = { ...e.vars }
      if (oldKey !== newKey) delete vars[oldKey]
      if (newKey) vars[newKey] = newVal
      return { ...e, vars }
    }))
  }
  const delVar = (id: string, key: string) => {
    setEnvs(envs.map(e => {
      if (e.id !== id) return e
      const vars = { ...e.vars }; delete vars[key]
      return { ...e, vars }
    }))
  }

  return (
    <div className="flex gap-4 h-[420px]">
      {/* Env list */}
      <div className={`w-48 shrink-0 flex flex-col border rounded-lg ${isDark ? 'border-zinc-800' : 'border-slate-200'}`}>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {envs.map(env => (
            <div key={env.id} className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer ${sel === env.id ? (isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-700') : (isDark ? 'hover:bg-zinc-800 text-zinc-300' : 'hover:bg-slate-50 text-slate-700')}`}
              onClick={() => setSel(env.id)}>
              <span className="flex-1 text-xs truncate">{env.name}</span>
              {activeEnvId === env.id && <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-500">当前</span>}
              <button onClick={e => { e.stopPropagation(); delEnv(env.id) }} className={`shrink-0 opacity-0 group-hover:opacity-100 ${muted} hover:text-red-500`}><Trash2 size={11} /></button>
            </div>
          ))}
        </div>
        <button onClick={addEnv} className={`p-2 text-xs flex items-center gap-1 border-t ${isDark ? 'border-zinc-800 text-zinc-400 hover:bg-zinc-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}><Plus size={11} />新增环境</button>
      </div>

      {/* Env detail */}
      <div className="flex-1 flex flex-col min-h-0">
        {!cur ? (
          <div className={`flex-1 flex items-center justify-center text-xs ${muted}`}>请选择或新增环境</div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3 shrink-0">
              <input value={cur.name} onChange={e => renameEnv(cur.id, e.target.value)} className={inp + ' flex-1'} />
              <button onClick={() => setActiveEnvId(cur.id)} disabled={activeEnvId === cur.id}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${activeEnvId === cur.id ? 'bg-emerald-600/20 text-emerald-500 cursor-default' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
                {activeEnvId === cur.id ? '已激活' : '设为当前'}
              </button>
            </div>
            <div className={`flex-1 overflow-y-auto space-y-1 border rounded-lg p-2 ${isDark ? 'border-zinc-800' : 'border-slate-200'}`}>
              {Object.entries(cur.vars).map(([k, v]) => (
                <VarRow key={k} kv={{ k, v }} inpCls={inp} muted={muted}
                  onChange={(nk, nv) => updVar(cur.id, k, nk, nv)}
                  onDelete={() => delVar(cur.id, k)} />
              ))}
              <VarRow kv={{ k: '', v: '' }} inpCls={inp} muted={muted}
                onChange={(nk, nv) => { if (nk) updVar(cur.id, '', nk, nv) }} newRow />
            </div>
            <p className={`mt-3 text-[10px] ${muted}`}>在 URL/Header/Body 中通过 <code>{'{{变量名}}'}</code> 引用当前环境的变量。</p>
          </>
        )}
      </div>
    </div>
  )
}
function VarRow({ kv, onChange, onDelete, inpCls, muted, newRow }: {
  kv: { k: string; v: string }; onChange: (k: string, v: string) => void
  onDelete?: () => void; inpCls: string; muted: string; newRow?: boolean
}) {
  const [k, setK] = useState(kv.k); const [v, setV] = useState(kv.v)
  useEffect(() => { setK(kv.k); setV(kv.v) }, [kv.k, kv.v])
  return (
    <div className="flex items-center gap-1.5 group">
      <input value={k} onChange={e => { setK(e.target.value); onChange(e.target.value, v) }} placeholder="变量名" className={inpCls + ' flex-1'} />
      <input value={v} onChange={e => { setV(e.target.value); onChange(k, e.target.value) }} placeholder="值" className={inpCls + ' flex-1'} />
      {!newRow && (
        <button onClick={onDelete} className={`w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 ${muted} hover:text-red-500`}>
          <Trash2 size={11} />
        </button>
      )}
      {newRow && <span className={`text-[10px] w-6 text-center ${muted}`}><Plus size={11} className="inline" /></span>}
    </div>
  )
}
