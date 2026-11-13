import React, { useState } from 'react';
import { FileText, Lock, RotateCcw } from 'lucide-react';
import { AIPromptConfig, AIPromptDefaults, PromptIntent } from '../types';
import { PROMPT_INTENTS } from '../utils/aiPrompts';
import { SectionHeader } from './ui';

interface AIPromptEditorProps {
  value: AIPromptConfig;
  onChange: (value: AIPromptConfig) => void;
  defaults: AIPromptDefaults | null;
}

type EditorTab = PromptIntent | 'extra_rules';

const AIPromptEditor: React.FC<AIPromptEditorProps> = ({ value, onChange, defaults }) => {
  const [tab, setTab] = useState<EditorTab>('default');
  const maxLength = defaults?.max_length ?? 4000;

  const builtin = tab === 'extra_rules' ? '' : defaults?.prompts[tab] ?? '';
  const customized = tab !== 'extra_rules' && Boolean(value[tab]);
  // 未自定义时直接展示内置提示词，在它的基础上改；改回与内置一致视为未自定义
  const text = tab === 'extra_rules' ? value.extra_rules : value[tab] || builtin;

  const updateText = (next: string) => {
    if (tab === 'extra_rules') {
      onChange({ ...value, extra_rules: next });
      return;
    }
    onChange({ ...value, [tab]: next.trim() === builtin.trim() ? '' : next });
  };

  const tabs: Array<{ id: EditorTab; label: string; customized: boolean }> = [
    ...PROMPT_INTENTS.map(intent => ({ id: intent.id as EditorTab, label: intent.label, customized: Boolean(value[intent.id]) })),
    { id: 'extra_rules', label: '补充规则', customized: Boolean(value.extra_rules) },
  ];
  const hint = tab === 'extra_rules'
    ? '追加在所有场景的提示词后面，适合写店铺统一的语气和禁忌，例如“不承诺当天发货”。'
    : PROMPT_INTENTS.find(intent => intent.id === tab)?.hint;

  return (
    <section className="section-panel">
      <SectionHeader
        title="提示词"
        description="系统按买家消息自动判断场景，再使用对应的提示词。留空即使用内置版本。"
        icon={FileText}
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="提示词场景">
          {tabs.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold ${
                tab === item.id
                  ? 'border-amber-400 bg-[#ffe100] text-black'
                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {item.label}
              {item.customized && <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-label="已自定义" />}
            </button>
          ))}
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs leading-5 text-gray-500">{hint}</p>
            {tab !== 'extra_rules' && (
              <div className="flex items-center gap-2">
                <span className={`status-badge ${customized ? 'status-badge-success' : 'bg-gray-100 text-gray-600'}`}>
                  {customized ? '已自定义' : '内置'}
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ ...value, [tab]: '' })}
                  disabled={!customized}
                  className="ios-btn-secondary flex items-center gap-1 rounded-md px-2.5 py-1 text-xs disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  恢复默认
                </button>
              </div>
            )}
          </div>
          <textarea
            value={text}
            onChange={event => updateText(event.target.value)}
            maxLength={maxLength}
            className="ios-input min-h-48 w-full resize-y rounded-md px-3 py-2.5 text-sm leading-6"
            placeholder={tab === 'extra_rules' ? '例如：语气简洁，不承诺未确认的库存；涉及售后时引导买家说明订单号。' : ''}
          />
          <p className="mt-1 text-right text-xs text-gray-400">{text.length} / {maxLength}</p>
        </div>

        {defaults?.safety_preview && (
          <details className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-700">
              <Lock className="h-4 w-4" />
              系统固定追加的内容（不可编辑）
            </summary>
            <p className="mt-2 text-xs leading-5 text-gray-500">
              每次调用都会追加在上面的提示词后面。议价底价校验和防止泄露内部规则的检查依赖这段内容，所以不开放修改。
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-gray-600">{defaults.safety_preview}</pre>
          </details>
        )}
      </div>
    </section>
  );
};

export default AIPromptEditor;
