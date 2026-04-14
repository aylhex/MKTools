import { useState, useCallback, useEffect, useRef } from 'react'
import { Send, Plus, Trash2, RefreshCw, Copy, ChevronDown, AlertCircle, Globe, WrapText, Check, Clock, Trash, Search, X } from 'lucide-react'
import { Theme } from '../types'

interface AppRequestProps { theme: Theme }

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
type BodyType   = 'none' | 'form-data' | 'json' | 'xml' | 'binary' | 'graphql'
type ReqTab     = 'headers' | 'body' | 'history'
type ResTab     = 'body' | 'headers'

interface KVPair { id: string; key: string; value: string; enabled: boolean }

interface RequestState {
  method: HttpMethod; url: string
  headers: KVPair[]
  bodyType: BodyType; bodyJson: string; bodyXml: string; bodyGql: string; bodyGqlVars: string
  formData: KVPair[]
}

interface ResponseState {
  status: number; statusText: string; time: number; size: number
  headers: Record<string, string>; body: string; contentType: string; error?: string
}

interface HistoryEntry { id: string; timestamp: number; method: HttpMethod; url: string; req: RequestState }

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

function mkKV(): KVPair { return { id: Math.random().toString(36).slice(2), key: '', value: '', enabled: true } }

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
    else if (m[5]) {
      const after = text.slice(m.index + full.length).match(/^\s*[:(]/)
      parts.push(<span key={ki} style={{ color: KW.has(full) ? C.kw : after ? C.field : C.field }}>{full}</span>)
    } else if (m[6]) parts.push(<span key={ki} style={{ color: C.sym }}>{full}</span>)
    last = m.index + full.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

// ── Highlighted code editor (textarea overlay technique) ────────────────────
function HighlightEditor({ value, onChange, language, isDark, minHeight = 280, placeholder, fill = false }: {
  value: string; onChange: (v: string) => void; language: 'json' | 'xml' | 'gql'
  isDark: boolean; minHeight?: number; placeholder?: string; fill?: boolean
}) {
  const preRef = useRef<HTMLPreElement>(null)
  const taRef  = useRef<HTMLTextAreaElement>(null)
  const syncScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop  = taRef.current.scrollTop
      preRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }
  const highlighted = language === 'json' ? highlightJson(value, isDark)
    : language === 'xml'  ? highlightXml(value, isDark)
    : highlightGql(value, isDark)
  const shared: React.CSSProperties = {
    fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
    fontSize: 12, lineHeight: 1.625, padding: 12,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'break-word', tabSize: 2,
  }
  return (
    <div
      className={`relative rounded-xl border transition-all focus-within:ring-1 ${fill ? 'flex-1 min-h-0' : ''} ${isDark ? 'bg-zinc-900 border-zinc-700/60 focus-within:border-blue-500/40 focus-within:ring-blue-500/10' : 'bg-white border-slate-200 focus-within:border-blue-400/60 focus-within:ring-blue-400/10'}`}
      style={fill ? undefined : { minHeight }}
    >
      <pre ref={preRef} aria-hidden style={{ ...shared, position: 'absolute', inset: 0, margin: 0, overflow: 'hidden', pointerEvents: 'none', color: isDark ? '#e4e4e7' : '#334155' }}>
        {highlighted}{'\n'}
      </pre>
      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
            e.preventDefault()
            ;(e.currentTarget as HTMLTextAreaElement).select()
          }
        }}
        spellCheck={false}
        placeholder={placeholder}
        style={{ ...shared, position: 'absolute', inset: 0, width: '100%', height: '100%', background: 'transparent', color: 'transparent', caretColor: isDark ? '#e4e4e7' : '#1e293b', resize: 'none', border: 'none', outline: 'none', zIndex: 1 }}
        className={isDark ? 'placeholder-zinc-600' : 'placeholder-slate-300'}
      />
    </div>
  )
}

// ── KVEditor ────────────────────────────────────────────────────────────────
function KVEditor({ pairs, onChange, isDark, keyPh = 'Key', valPh = 'Value' }: {
  pairs: KVPair[]; onChange: (p: KVPair[]) => void; isDark: boolean; keyPh?: string; valPh?: string
}) {
  const upd = (id: string, f: keyof KVPair, v: string | boolean) => onChange(pairs.map(p => p.id === id ? { ...p, [f]: v } : p))
  const inp = `flex-1 px-2.5 py-1.5 text-xs rounded-md border font-mono outline-none transition-all ${isDark ? 'bg-zinc-900 border-zinc-700/60 text-zinc-200 placeholder-zinc-600 focus:border-blue-500/50' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-300 focus:border-blue-400'}`
  return (
    <div>
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
            <input value={p.key}   onChange={e => upd(p.id, 'key',   e.target.value)} placeholder={keyPh} className={inp} />
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

const INIT_REQ: RequestState = {
  method: 'GET', url: '', headers: [mkKV()],
  bodyType: 'none', bodyJson: '{\n  \n}',
  bodyXml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  \n</root>',
  bodyGql: '{\n  \n}', bodyGqlVars: '{}', formData: [mkKV()],
}

const HISTORY_KEY = 'mk-req-history'
const MAX_HISTORY = 50
function loadHistory(): HistoryEntry[] { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] } }

function formatSize(b: number) { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB` }
function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  return s < 60 ? `${s}秒前` : s < 3600 ? `${Math.floor(s / 60)}分钟前` : s < 86400 ? `${Math.floor(s / 3600)}小时前` : `${Math.floor(s / 86400)}天前`
}

// ── Main component ───────────────────────────────────────────────────────────
export function AppRequest({ theme }: AppRequestProps) {
  const isDark = theme === 'dark'
  const [req, setReq] = useState<RequestState>(INIT_REQ)
  const [reqTab, setReqTab] = useState<ReqTab>('body')
  const [resTab, setResTab] = useState<ResTab>('body')
  const [response, setResponse] = useState<ResponseState | null>(null)
  const [loading, setLoading] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [formatError, setFormatError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [historySearch, setHistorySearch] = useState('')
  const [, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 60000); return () => clearInterval(t) }, [])

  const historyRef = useRef(history); historyRef.current = history

  const upd = <K extends keyof RequestState>(f: K, v: RequestState[K]) => setReq(prev => ({ ...prev, [f]: v }))

  const applyFormat = useCallback((field: 'bodyJson' | 'bodyXml' | 'bodyGql' | 'bodyGqlVars', type: 'json' | 'xml' | 'gql') => {
    setFormatError(null)
    const { result, error } = type === 'json' ? tryFormatJson(req[field]) : type === 'xml' ? tryFormatXml(req[field]) : tryFormatGql(req[field])
    if (error) setFormatError(error)
    else upd(field, result)
  }, [req])

  const pushHistory = useCallback((r: RequestState) => {
    if (!r.url.trim()) return
    const entry: HistoryEntry = { id: Math.random().toString(36).slice(2), timestamp: Date.now(), method: r.method, url: r.url, req: { ...r } }
    const next = [entry, ...historyRef.current].slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); setHistory(next)
  }, [])

  const sendRequest = useCallback(async () => {
    if (!req.url.trim()) return
    setLoading(true); setResponse(null)
    const start = performance.now()
    try {
      let url = req.url.trim()
      if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url
      const headers: Record<string, string> = {}
      req.headers.filter(h => h.enabled && h.key).forEach(h => { headers[h.key] = h.value })
      let bodyStr: string | undefined
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.bodyType === 'json') { bodyStr = req.bodyJson; if (!headers['Content-Type']) headers['Content-Type'] = 'application/json' }
        else if (req.bodyType === 'xml') { bodyStr = req.bodyXml; if (!headers['Content-Type']) headers['Content-Type'] = 'application/xml' }
        else if (req.bodyType === 'graphql') {
          const b: { query: string; variables?: unknown } = { query: req.bodyGql }
          if (req.bodyGqlVars.trim()) { try { b.variables = JSON.parse(req.bodyGqlVars) } catch (_) { /* ignore */ } }
          bodyStr = JSON.stringify(b); if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'
        } else if (req.bodyType === 'form-data') {
          const boundary = '----Boundary' + Math.random().toString(36).slice(2)
          const parts = req.formData.filter(f => f.enabled && f.key).map(f => `--${boundary}\r\nContent-Disposition: form-data; name="${f.key}"\r\n\r\n${f.value}`)
          bodyStr = parts.join('\r\n') + `\r\n--${boundary}--\r\n`
          if (!headers['Content-Type']) headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`
        }
      }
      const result = await window.ipcRenderer.invoke('http-request', { method: req.method, url, headers, body: bodyStr }) as { status: number; statusText: string; headers: Record<string, string>; body: string }
      const time = Math.round(performance.now() - start)
      const ct = result.headers['content-type'] ?? ''
      setResponse({ status: result.status, statusText: result.statusText, time, size: new TextEncoder().encode(result.body).length, headers: result.headers, body: ct.includes('json') ? tryFormatJson(result.body).result : result.body, contentType: ct })
      setResTab('body'); pushHistory(req)
    } catch (e) {
      setResponse({ status: 0, statusText: 'Error', time: Math.round(performance.now() - start), size: 0, headers: {}, body: '', contentType: '', error: e instanceof Error ? e.message : String(e) })
    } finally { setLoading(false) }
  }, [req, pushHistory])

  const copyResponse = () => {
    if (!response?.body) return
    navigator.clipboard.writeText(response.body); setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  // ── Style helpers ────────────────────────────────────────────────────────
  const bg0 = isDark ? 'bg-zinc-950' : 'bg-slate-100'
  const bg1 = isDark ? 'bg-zinc-900' : 'bg-white'
  const bg2 = isDark ? 'bg-zinc-800/60' : 'bg-slate-50'
  const border = isDark ? 'border-zinc-800' : 'border-slate-200'
  const muted = isDark ? 'text-zinc-500' : 'text-slate-400'
  const tabBtn = (active: boolean) => `relative px-1 pb-2.5 pt-1 text-xs font-medium transition-colors ${active ? (isDark ? 'text-white' : 'text-slate-900') : (isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-700')}`
  const fmtBtn = `flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border font-medium transition-all ${isDark ? 'border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-200 hover:bg-zinc-800' : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50'}`
  const mStyle = (isDark ? METHOD_DARK : METHOD_LIGHT)[req.method]

  const filteredHistory = historySearch.trim()
    ? history.filter(h => h.url.toLowerCase().includes(historySearch.toLowerCase()) || h.method.toLowerCase().includes(historySearch.toLowerCase()))
    : history

  return (
    <div className={`h-full flex flex-col ${bg0}`} onClick={() => methodOpen && setMethodOpen(false)}>

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
            <input value={req.url} onChange={e => upd('url', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sendRequest() }} placeholder="https://api.example.com/endpoint" className={`flex-1 bg-transparent text-sm font-mono outline-none ${isDark ? 'text-zinc-100 placeholder-zinc-600' : 'text-slate-800 placeholder-slate-400'}`} />
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
          <div className={`flex items-end gap-5 px-4 border-b ${border} ${bg1} shrink-0`}>
            {([['body','请求体'],['headers','请求头'],['history','历史']] as [ReqTab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setReqTab(t)} className={tabBtn(reqTab === t)}>
                {t === 'history'
                  ? <span className="flex items-center gap-1"><Clock size={11} />{label}{history.length > 0 && <span className={`ml-0.5 text-[10px] px-1 rounded-full ${isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-slate-100 text-slate-500'}`}>{history.length}</span>}</span>
                  : label}
                {reqTab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-blue-500" />}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className={`flex-1 flex flex-col min-h-0 ${bg1}`}>

            {/* Headers */}
            {reqTab === 'headers' && (
              <div className="flex-1 overflow-y-auto p-4">
                <KVEditor pairs={req.headers} onChange={v => upd('headers', v)} isDark={isDark} keyPh="Header 名称" valPh="Header 值" />
              </div>
            )}

            {/* Body */}
            {reqTab === 'body' && (
              <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
                {/* Type selector + format button */}
                <div className="flex items-center justify-between gap-2 shrink-0">
                  <div className={`flex items-center gap-1 flex-1 p-1 rounded-xl ${isDark ? 'bg-zinc-800/60' : 'bg-slate-100'}`}>
                    {(['none','form-data','json','xml','graphql','binary'] as BodyType[]).map(b => (
                      <button key={b} onClick={() => { upd('bodyType', b); setFormatError(null) }} className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${req.bodyType === b ? (isDark ? 'bg-zinc-700 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm') : (isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-400 hover:text-slate-700')}`}>
                        {b === 'none' ? '无' : b === 'binary' ? 'Binary' : b}
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
                    <p className="text-xs">该请求方法没有请求体</p>
                  </div>
                )}
                {req.bodyType === 'form-data' && (
                  <div className="flex-1 overflow-y-auto">
                    <KVEditor pairs={req.formData} onChange={v => upd('formData', v)} isDark={isDark} keyPh="字段名" valPh="字段值" />
                  </div>
                )}
                {req.bodyType === 'binary' && (
                  <div className={`flex-1 flex items-center justify-center rounded-xl border border-dashed ${isDark ? 'border-zinc-800 text-zinc-600' : 'border-slate-200 text-slate-400'}`}>
                    <p className="text-xs">Binary 上传请使用 form-data</p>
                  </div>
                )}
                {req.bodyType === 'json' && (
                  <HighlightEditor value={req.bodyJson} onChange={v => { upd('bodyJson', v); setFormatError(null) }} language="json" isDark={isDark} fill />
                )}
                {req.bodyType === 'xml' && (
                  <HighlightEditor value={req.bodyXml} onChange={v => { upd('bodyXml', v); setFormatError(null) }} language="xml" isDark={isDark} fill />
                )}
                {req.bodyType === 'graphql' && (
                  <div className="flex-1 flex flex-col min-h-0 gap-3">
                    <div className="flex-1 flex flex-col min-h-0">
                      <div className="flex items-center justify-between mb-2 shrink-0">
                        <span className={`text-[11px] font-semibold uppercase tracking-wider ${muted}`}>Query</span>
                        <button onClick={() => applyFormat('bodyGql', 'gql')} className={fmtBtn}><WrapText size={11} />格式化</button>
                      </div>
                      <HighlightEditor value={req.bodyGql} onChange={v => { upd('bodyGql', v); setFormatError(null) }} language="gql" isDark={isDark} fill placeholder="{ user(id: 1) { name email } }" />
                    </div>
                    <div className="shrink-0">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[11px] font-semibold uppercase tracking-wider ${muted}`}>Variables (JSON)</span>
                        <button onClick={() => applyFormat('bodyGqlVars', 'json')} className={fmtBtn}><WrapText size={11} />格式化</button>
                      </div>
                      <HighlightEditor value={req.bodyGqlVars} onChange={v => { upd('bodyGqlVars', v); setFormatError(null) }} language="json" isDark={isDark} minHeight={120} placeholder='{ "id": 1 }' />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* History */}
            {reqTab === 'history' && (
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {/* Search */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${isDark ? 'bg-zinc-800/60 border-zinc-700/60' : 'bg-slate-50 border-slate-200'}`}>
                  <Search size={13} className={muted} />
                  <input
                    value={historySearch}
                    onChange={e => setHistorySearch(e.target.value)}
                    placeholder="搜索 URL 或方法..."
                    className={`flex-1 bg-transparent text-xs outline-none font-mono ${isDark ? 'text-zinc-200 placeholder-zinc-600' : 'text-slate-800 placeholder-slate-400'}`}
                  />
                  {historySearch && (
                    <button onClick={() => setHistorySearch('')} className={`shrink-0 ${muted} hover:text-current transition-colors`}><X size={12} /></button>
                  )}
                </div>

                {/* Header row */}
                {history.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] ${muted}`}>
                      {historySearch ? `${filteredHistory.length} / ${history.length} 条` : `${history.length} 条记录`}
                    </span>
                    <button onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]) }} className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border transition-all ${isDark ? 'border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/5' : 'border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-300 hover:bg-red-50'}`}>
                      <Trash size={10} />清空
                    </button>
                  </div>
                )}

                {/* Empty states */}
                {history.length === 0 && (
                  <div className={`flex flex-col items-center justify-center py-12 gap-3 rounded-xl border border-dashed ${isDark ? 'border-zinc-800 text-zinc-600' : 'border-slate-200 text-slate-400'}`}>
                    <Clock size={28} strokeWidth={1.5} /><p className="text-xs">暂无历史记录</p>
                    <p className={`text-[11px] ${muted}`}>发送请求后自动保存</p>
                  </div>
                )}
                {history.length > 0 && filteredHistory.length === 0 && (
                  <div className={`flex flex-col items-center justify-center py-10 gap-2 rounded-xl border border-dashed ${isDark ? 'border-zinc-800 text-zinc-600' : 'border-slate-200 text-slate-400'}`}>
                    <Search size={22} strokeWidth={1.5} /><p className="text-xs">无匹配结果</p>
                  </div>
                )}

                {/* List */}
                <div className="flex flex-col gap-1">
                  {filteredHistory.map(entry => {
                    const ms = (isDark ? METHOD_DARK : METHOD_LIGHT)[entry.method]
                    return (
                      <button key={entry.id} onClick={() => { setReq(entry.req); setReqTab('body'); setResponse(null); setFormatError(null) }}
                        className={`group w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${isDark ? 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50' : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'}`}>
                        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${ms.bg} ${ms.border} ${ms.text}`}>{entry.method}</span>
                        <span className={`flex-1 text-xs font-mono truncate ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>{entry.url}</span>
                        <span className={`shrink-0 text-[11px] ${muted}`}>{timeAgo(entry.timestamp)}</span>
                        <button onClick={e => { e.stopPropagation(); const next = historyRef.current.filter(h => h.id !== entry.id); localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); setHistory(next) }}
                          className={`shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-all ${isDark ? 'text-zinc-600 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-300 hover:text-red-400 hover:bg-red-50'}`}>
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
              {([['body','响应体'],['headers','响应头']] as [ResTab, string][]).map(([t, label]) => (
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
                  <div className="flex-1 flex flex-col min-h-0 p-4">
                    <div className={`flex-1 flex flex-col min-h-0 rounded-xl border overflow-hidden ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200'}`}>
                      <pre
                        tabIndex={0}
                        onKeyDown={e => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
                            e.preventDefault()
                            const range = document.createRange()
                            range.selectNodeContents(e.currentTarget)
                            const sel = window.getSelection()
                            sel?.removeAllRanges()
                            sel?.addRange(range)
                          }
                        }}
                        className="flex-1 overflow-auto p-4 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed outline-none"
                      >
                        {response.contentType.includes('json')
                          ? highlightJson(response.body, isDark)
                          : <span style={{ color: isDark ? '#d4d4d8' : '#475569' }}>{response.body || <span className={muted}>(空响应体)</span>}</span>
                        }
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
    </div>
  )
}
