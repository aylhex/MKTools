/**
 * iosFilter.ts —— iOS 日志的 Console 风格过滤引擎
 *
 * 参考 macOS Console.app 的过滤模型：
 *  - 顶部有一组 "过滤 chip"（每个 chip = 字段 + 操作符 + 值），chip 之间 AND
 *  - 顶部还有一个"类别"快速切换（Any / Info+ / Debug+ / Errors and Faults）
 *  - 类别 与 chips 之间也是 AND
 */

import type { LogEntry, IosFilter, IosFilterField, IosFilterOp, IosFilterState, IosLogCategory } from '../types';

// ============ 类别 → level 阈值 ============

const LEVEL_ORDER: LogEntry['level'][] = ['V', 'D', 'I', 'W', 'E', 'F'];

export function categoryPasses(log: LogEntry, cat: IosLogCategory): boolean {
  const idx = LEVEL_ORDER.indexOf((log.level || 'I') as LogEntry['level']);
  if (idx === -1) return false;
  switch (cat) {
    case 'any':
      return true;
    case 'debug':
      // 只匹配 D 级
      return idx === LEVEL_ORDER.indexOf('D');
    case 'info':
      // 只匹配 I 级
      return idx === LEVEL_ORDER.indexOf('I');
    case 'errors':
      // Errors and Faults = E 及以上（即 E 和 F 两级）
      return idx >= LEVEL_ORDER.indexOf('E');
  }
}

// ============ Field 值提取 ============

function extractField(log: LogEntry, field: IosFilterField): string {
  switch (field) {
    case 'process':
      return log.tag || '';
    case 'pid':
      return String(log.pid ?? '');
    case 'message':
      return log.msg || '';
    case 'type':
      return (log.level || '').toUpperCase();
    case 'any':
    default:
      return `${log.tag || ''} ${log.msg || ''} ${log.pid ?? ''}`;
  }
}

// ============ 操作符匹配 ============

const TYPE_NAME_TO_LEVEL: Record<string, LogEntry['level']> = {
  default: 'I',
  info: 'I',
  debug: 'D',
  warning: 'W',
  warn: 'W',
  error: 'E',
  fault: 'F',
};

function normalizeTypeValue(v: string): string {
  return TYPE_NAME_TO_LEVEL[v.trim().toLowerCase()] || v.trim().toUpperCase();
}

function opMatches(op: IosFilterOp, target: string, raw: string): boolean {
  const t = target || '';
  const v = raw || '';
  const tl = t.toLowerCase();
  const vl = v.toLowerCase();
  switch (op) {
    case 'contains':
      return v === '' ? true : tl.includes(vl);
    case 'notContains':
      return v === '' ? true : !tl.includes(vl);
    case 'equals':
      return t === v;
    case 'notEquals':
      return t !== v;
    case 'startsWith':
      return tl.startsWith(vl);
    case 'endsWith':
      return tl.endsWith(vl);
    case 'regex': {
      try {
        return new RegExp(v, 'i').test(t);
      } catch {
        return false;
      }
    }
    default:
      return true;
  }
}

// ============ 单条 chip 匹配 ============

export function matchesFilter(log: LogEntry, f: IosFilter): boolean {
  if (f.disabled) return true;
  if (f.field === 'type') {
    const logLevel = (log.level || '').toUpperCase();
    const targetLevel = normalizeTypeValue(f.value);
    switch (f.op) {
      case 'notContains':
      case 'notEquals':
        return logLevel !== targetLevel;
      case 'regex':
        try { return new RegExp(f.value, 'i').test(logLevel); } catch { return false; }
      default:
        return logLevel === targetLevel;
    }
  }
  return opMatches(f.op, extractField(log, f.field), f.value);
}

// ============ 整体过滤 ============

export function matchLogEntry(log: LogEntry, state: IosFilterState): boolean {
  if (!categoryPasses(log, state.category)) return false;
  for (const f of state.filters) {
    if (!matchesFilter(log, f)) return false;
  }
  return true;
}

// ============ 搜索框语法解析 ============

/**
 * 支持的语法：
 *   - `process:SpringBoard`
 *   - `pid:1234`
 *   - `type:error`  (等价 `type:E`)
 *   - `message:crash`  或  `msg:crash`
 *   - `regex:/foo(bar)?/`
 *   - 无前缀：`crash` → 综合搜索 (any contains crash)
 *
 * 也支持在字段前加 `!` / `-` 表示 not：`!process:foo` / `-message:noise`
 */
export function parseSearchInput(input: string): IosFilter | null {
  const raw = input.trim();
  if (!raw) return null;

  let negated = false;
  let body = raw;
  if (body.startsWith('!') || body.startsWith('-')) {
    negated = true;
    body = body.slice(1).trim();
    if (!body) return null;
  }

  const m = body.match(/^([a-zA-Z_]+)\s*:\s*(.*)$/s);
  if (!m) {
    return {
      id: genId(),
      field: 'any',
      op: negated ? 'notContains' : 'contains',
      value: body,
    };
  }

  const rawField = m[1].toLowerCase();
  const value = m[2];

  const field: IosFilterField = (() => {
    switch (rawField) {
      case 'process':
      case 'proc':
      case 'tag':
      case 'sender':
        return 'process';
      case 'pid':
        return 'pid';
      case 'msg':
      case 'message':
      case 'body':
        return 'message';
      case 'type':
      case 'level':
        return 'type';
      case 'regex':
        return 'any';
      case 'any':
      case 'all':
        return 'any';
      default:
        return 'any';
    }
  })();

  const op: IosFilterOp = rawField === 'regex' ? 'regex' : (negated ? 'notContains' : 'contains');

  return { id: genId(), field, op, value };
}

// ============ 工具 ============

let _counter = 0;
export function genId(): string {
  _counter = (_counter + 1) & 0xffff;
  return `f_${Date.now().toString(36)}_${_counter.toString(36)}`;
}

/** 展示用的字段/操作符标签 */
export const FIELD_LABEL: Record<IosFilterField, string> = {
  any: 'Any',
  process: 'Process',
  pid: 'PID',
  message: 'Message',
  type: 'Type',
};

export const OP_LABEL: Record<IosFilterOp, string> = {
  contains: '包含',
  notContains: '不包含',
  equals: '等于',
  notEquals: '不等于',
  startsWith: '以…开头',
  endsWith: '以…结尾',
  regex: '正则',
};

export const CATEGORY_LABEL: Record<IosLogCategory, string> = {
  any: 'Any',
  info: 'Info',
  debug: 'Debug',
  errors: 'Errors and Faults',
};
