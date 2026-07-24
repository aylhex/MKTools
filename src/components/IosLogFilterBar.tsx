import React, { useState } from 'react';
import type {
  IosFilter,
  IosFilterField,
  IosFilterOp,
  IosFilterState,
  IosLogCategory,
  Theme,
} from '../types';
import {
  CATEGORY_LABEL,
  FIELD_LABEL,
  OP_LABEL,
  genId,
} from '../utils/iosFilter';
import { X, ChevronDown, Filter as FilterIcon } from 'lucide-react';

interface IosLogFilterBarProps {
  state: IosFilterState;
  onChange: (state: IosFilterState) => void;
  theme: Theme;
  totalCount: number;
  matchedCount: number;
}

/**
 * IosLogFilterBar —— 侧边栏版本的 iOS 日志过滤器（macOS Console.app 风格 + Android 侧一致视觉）。
 *
 * 布局（从上到下）：
 *   ┌ Live Filters                             (标题 + 计数)
 *   ├ CATEGORY
 *   │ [Any][Info+][Debug+][Errors&F]           (2×2 类别快切)
 *   ├ NEW FILTER
 *   │ [field ▼] [op ▼]                         (常驻的字段+操作符+值编辑区)
 *   │ [value _______________]
 *   │ [+ 添加]
 *   ├ ACTIVE FILTERS (n)                        (仅当有 chip 时显示)
 *   │ [chip1 ▼×] …                              (点击 chip 禁用/展开修改/删除)
 *   │ 全部清除
 */
export const IosLogFilterBar: React.FC<IosLogFilterBarProps> = ({
  state,
  onChange,
  theme,
  totalCount,
  matchedCount,
}) => {
  const isDark = theme === 'dark';
  const [showAdvancedFor, setShowAdvancedFor] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState<IosFilter>({
    id: genId(),
    field: 'process',
    op: 'contains',
    value: '',
  });

  const setCategory = (c: IosLogCategory) => onChange({ ...state, category: c });

  const addFilter = (f: IosFilter) => {
    onChange({ ...state, filters: [...state.filters, f] });
  };

  const removeFilter = (id: string) => {
    onChange({ ...state, filters: state.filters.filter((x) => x.id !== id) });
  };

  const toggleFilterDisabled = (id: string) => {
    onChange({
      ...state,
      filters: state.filters.map((x) => (x.id === id ? { ...x, disabled: !x.disabled } : x)),
    });
  };

  const updateFilter = (id: string, patch: Partial<IosFilter>) => {
    onChange({
      ...state,
      filters: state.filters.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    });
  };

  const clearAllFilters = () => onChange({ ...state, filters: [] });

  // 提交新过滤器：type 字段 value 允许为空（用 select 默认值），其他字段要求非空
  const canSubmitDraft = addDraft.value.trim().length > 0 || addDraft.field === 'type';
  const commitDraft = () => {
    if (!canSubmitDraft) return;
    addFilter({ ...addDraft, id: genId() });
    // 提交后清空 value，保留 field/op，便于连续添加同类过滤
    setAddDraft({ id: genId(), field: addDraft.field, op: addDraft.op, value: '' });
  };

  // ========== Android 侧一致的视觉常量 ==========
  const labelCls = `block text-[10px] font-bold ${isDark ? 'text-zinc-400' : 'text-zinc-500'} mb-2 uppercase tracking-widest`;

  return (
    <div className="space-y-6">
      {/* 标题：与 Android 一致 */}
      <div className={`flex items-center gap-2 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
        <FilterIcon size={14} />
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em]">Live Filters</h2>
        <span className={`ml-auto text-[10px] font-mono ${isDark ? 'text-zinc-500' : 'text-slate-500'}`}>
          <span className={`font-bold ${isDark ? 'text-zinc-300' : 'text-slate-800'}`}>{matchedCount.toLocaleString()}</span>
          <span className="opacity-60"> / {totalCount.toLocaleString()}</span>
        </span>
      </div>

      {/* Category —— 快速类别切换 */}
      <div className="group">
        <label className={labelCls}>Category</label>
        <div className="grid grid-cols-2 gap-1.5">
          {(['any', 'info', 'debug', 'errors'] as IosLogCategory[]).map((c) => {
            const active = state.category === c;
            return (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-500/30'
                    : isDark
                      ? 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
                title={`仅显示 ${CATEGORY_LABEL[c]} 类别日志`}
              >
                {CATEGORY_LABEL[c]}
              </button>
            );
          })}
        </div>
      </div>

      {/* 常驻的"新过滤器"编辑区 —— 无需点击即可直接看到并使用 */}
      <div className="group">
        <label className={labelCls}>New Filter</label>
        <div className="space-y-2">
          <FieldOpValueRow
            filter={addDraft}
            theme={theme}
            onChange={(p) => setAddDraft((prev) => ({ ...prev, ...p }))}
            onSubmit={commitDraft}
          />
          <button
            onClick={commitDraft}
            disabled={!canSubmitDraft}
            className={`w-full px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
              !canSubmitDraft
                ? isDark
                  ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed border border-zinc-800'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                : 'bg-blue-600 text-white hover:bg-blue-500 shadow-sm shadow-blue-500/30'
            }`}
            title="回车也可提交"
          >
            + 添加过滤器
          </button>
        </div>
      </div>

      {/* Active Filters (chips) —— 只在有 chip 时显示 */}
      {state.filters.length > 0 && (
        <div className="group">
          <div className="flex items-center justify-between mb-2">
            <label className={`text-[10px] font-bold ${isDark ? 'text-zinc-400' : 'text-zinc-500'} uppercase tracking-widest`}>
              Active Filters
              <span className={`ml-1.5 text-[9px] ${isDark ? 'text-zinc-500' : 'text-slate-500'}`}>({state.filters.length})</span>
            </label>
            <button
              onClick={clearAllFilters}
              className={`text-[10px] font-medium underline underline-offset-2 ${
                isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-slate-500 hover:text-slate-800'
              }`}
              title="清空所有过滤条件"
            >
              全部清除
            </button>
          </div>
          <div className="space-y-1.5">
            {state.filters.map((f) => (
              <FilterChipRow
                key={f.id}
                filter={f}
                theme={theme}
                expanded={showAdvancedFor === f.id}
                onToggleAdvanced={() => setShowAdvancedFor((prev) => (prev === f.id ? null : f.id))}
                onToggleDisabled={() => toggleFilterDisabled(f.id)}
                onUpdate={(patch) => updateFilter(f.id, patch)}
                onRemove={() => removeFilter(f.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== FilterChipRow —— 侧边栏纵向 chip ====================

interface FilterChipRowProps {
  filter: IosFilter;
  theme: Theme;
  expanded: boolean;
  onToggleAdvanced: () => void;
  onToggleDisabled: () => void;
  onUpdate: (patch: Partial<IosFilter>) => void;
  onRemove: () => void;
}

const FilterChipRow: React.FC<FilterChipRowProps> = ({
  filter,
  theme,
  expanded,
  onToggleAdvanced,
  onToggleDisabled,
  onUpdate,
  onRemove,
}) => {
  const isDark = theme === 'dark';
  const disabled = !!filter.disabled;

  const chipCls = disabled
    ? isDark
      ? 'bg-zinc-800/40 text-zinc-500 border border-zinc-700/40'
      : 'bg-slate-100 text-slate-400 border border-slate-200'
    : isDark
      ? 'bg-blue-500/10 text-blue-300 border border-blue-500/30'
      : 'bg-blue-50 text-blue-700 border border-blue-200';

  return (
    <div className={`rounded-lg text-[11px] ${chipCls} overflow-hidden`}>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          onClick={onToggleDisabled}
          className={`flex-1 min-w-0 text-left ${disabled ? 'line-through opacity-70' : ''}`}
          title={disabled ? '点击启用此过滤条件' : '点击暂时禁用此过滤条件'}
        >
          <span className="font-semibold uppercase tracking-wide text-[10px]">
            {FIELD_LABEL[filter.field]}
          </span>
          <span className="opacity-60 mx-1">{OP_LABEL[filter.op]}</span>
          <span className="font-mono truncate">"{filter.value || '(空)'}"</span>
        </button>
        <button
          onClick={onToggleAdvanced}
          className={`p-1 rounded shrink-0 hover:${isDark ? 'bg-blue-500/20' : 'bg-blue-100'}`}
          title="修改字段/操作符"
        >
          <ChevronDown size={11} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <button
          onClick={onRemove}
          className={`p-1 rounded shrink-0 hover:${isDark ? 'bg-red-500/20 text-red-300' : 'bg-red-100 text-red-700'}`}
          title="删除此过滤条件"
        >
          <X size={11} />
        </button>
      </div>

      {expanded && (
        <div className={`px-2 pb-2 pt-1 border-t ${isDark ? 'border-blue-500/20' : 'border-blue-200'}`}>
          <FieldOpValueRow filter={filter} theme={theme} onChange={onUpdate} />
        </div>
      )}
    </div>
  );
};

// ==================== FieldOpValueRow ====================

interface FieldOpValueRowProps {
  filter: IosFilter;
  theme: Theme;
  onChange: (patch: Partial<IosFilter>) => void;
  onSubmit?: () => void; // 回车快捷提交（可选）
}

const FieldOpValueRow: React.FC<FieldOpValueRowProps> = ({ filter, theme, onChange, onSubmit }) => {
  const isDark = theme === 'dark';
  const inputBg = isDark ? 'bg-zinc-950' : 'bg-white';
  const inputBorder = isDark ? 'border-zinc-800' : 'border-slate-300';
  const inputText = isDark ? 'text-zinc-200' : 'text-slate-800';

  const selectCls = `${inputBg} ${inputBorder} border rounded px-1.5 py-1 text-[10px] ${inputText} focus:outline-none focus:border-blue-500/60 flex-1 min-w-0`;
  const inputCls = `${inputBg} ${inputBorder} border rounded px-2 py-1 text-[10px] font-mono ${inputText} focus:outline-none focus:border-blue-500/60 w-full`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <select
          value={filter.field}
          onChange={(e) => onChange({ field: e.target.value as IosFilterField })}
          className={selectCls}
        >
          {(Object.keys(FIELD_LABEL) as IosFilterField[]).map((k) => (
            <option key={k} value={k}>{FIELD_LABEL[k]}</option>
          ))}
        </select>
        <select
          value={filter.op}
          onChange={(e) => onChange({ op: e.target.value as IosFilterOp })}
          className={selectCls}
        >
          {(Object.keys(OP_LABEL) as IosFilterOp[]).map((k) => (
            <option key={k} value={k}>{OP_LABEL[k]}</option>
          ))}
        </select>
      </div>
      {filter.field === 'type' ? (
        <select
          value={filter.value || 'error'}
          onChange={(e) => onChange({ value: e.target.value })}
          className={inputCls}
        >
          <option value="default">Default</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
          <option value="fault">Fault</option>
        </select>
      ) : (
        <input
          value={filter.value}
          onChange={(e) => onChange({ value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="输入值后回车快速添加…"
          className={inputCls}
        />
      )}
    </div>
  );
};
