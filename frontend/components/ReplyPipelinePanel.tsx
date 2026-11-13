import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ListOrdered, Loader2, Save, Smartphone } from 'lucide-react';
import { DefaultReply, ReplyPipelineConfig, ReplyPipelineStage, ReplyStageKey } from '../types';
import { getReplyPipeline, saveReplyPipeline } from '../services/api';
import { apiErrorMessage, notify } from '../services/feedback';
import {
  NATIVE_MODE_OPTIONS,
  PRESET_OPTIONS,
  REPLY_PIPELINE_CHANGED_EVENT,
  STAGE_HINTS,
  STAGE_LABELS,
} from '../utils/replyPipeline';
import { PageLoading, SectionHeader } from './ui';

interface ReplyPipelinePanelProps {
  cookieId: string;
  defaultReply?: DefaultReply;
}

const ALL_STAGES: ReplyStageKey[] = ['keyword', 'ai', 'item_reply', 'default'];

const stagesFromPreset = (order: ReplyStageKey[], current: ReplyPipelineStage[]): ReplyPipelineStage[] => {
  const requireHit = current.find(stage => stage.key === 'ai')?.require_knowledge_hit ?? false;
  const build = (key: ReplyStageKey, enabled: boolean): ReplyPipelineStage =>
    key === 'ai' ? { key, enabled, require_knowledge_hit: requireHit } : { key, enabled };
  return [
    ...order.map(key => build(key, true)),
    ...ALL_STAGES.filter(key => !order.includes(key)).map(key => build(key, false)),
  ];
};

const matchPreset = (stages: ReplyPipelineStage[], presets: Record<string, ReplyStageKey[]>): string => {
  const enabled = stages.filter(stage => stage.enabled).map(stage => stage.key).join(',');
  const found = Object.entries(presets).find(([, order]) => order.join(',') === enabled);
  return found ? found[0] : 'custom';
};

const ReplyPipelinePanel: React.FC<ReplyPipelinePanelProps> = ({ cookieId, defaultReply }) => {
  const [config, setConfig] = useState<ReplyPipelineConfig | null>(null);
  const [presets, setPresets] = useState<Record<string, ReplyStageKey[]>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    getReplyPipeline(cookieId)
      .then(result => {
        setConfig(result.config);
        setPresets(result.presets);
      })
      .catch(error => notify(apiErrorMessage(error, '加载回复顺序失败'), 'error'))
      .finally(() => setLoading(false));
  }, [cookieId]);

  if (loading || !config) return <PageLoading label="正在加载回复顺序" />;

  const updateStages = (stages: ReplyPipelineStage[]) => {
    setConfig({ ...config, stages, preset: matchPreset(stages, presets) });
  };

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= config.stages.length) return;
    const stages = [...config.stages];
    [stages[index], stages[target]] = [stages[target], stages[index]];
    updateStages(stages);
  };

  const patchStage = (index: number, patch: Partial<ReplyPipelineStage>) => {
    updateStages(config.stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)));
  };

  const choosePreset = (id: string) => {
    if (id === 'custom' || !presets[id]) {
      setConfig({ ...config, preset: 'custom' });
      return;
    }
    setConfig({ ...config, preset: id, stages: stagesFromPreset(presets[id], config.stages) });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await saveReplyPipeline(cookieId, config);
      setConfig(saved);
      window.dispatchEvent(new CustomEvent<string>(REPLY_PIPELINE_CHANGED_EVENT, { detail: cookieId }));
      notify('回复顺序已保存', 'success');
    } catch (error) {
      notify(apiErrorMessage(error, '保存回复顺序失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const enabledStages = config.stages.filter(stage => stage.enabled);
  const defaultIndex = enabledStages.findIndex(stage => stage.key === 'default');
  const defaultBlocksLater = defaultIndex >= 0
    && defaultIndex < enabledStages.length - 1
    && Boolean(defaultReply?.enabled)
    && !defaultReply?.reply_once;
  const waitsForNative = config.native_auto_reply_mode !== 'legacy';

  return (
    <div className="space-y-5">
      <section className="section-panel">
        <SectionHeader
          title="回复顺序"
          description="买家消息依次经过下面的环节，前一个环节回复了就不再往下走；没有回复则交给下一个。"
          icon={ListOrdered}
          actions={(
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="ios-btn-primary flex items-center gap-2 rounded-md px-4 py-2 text-sm"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? '保存中' : '保存'}
            </button>
          )}
        />
        <div className="space-y-5 p-5">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" role="radiogroup" aria-label="预设方案">
            {PRESET_OPTIONS.map(option => {
              const active = config.preset === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => choosePreset(option.id)}
                  className={`rounded-md border px-3 py-2.5 text-left ${
                    active ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="block text-sm font-bold text-gray-900">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-gray-500">{option.description}</span>
                </button>
              );
            })}
          </div>

          <ol className="space-y-2">
            {config.stages.map((stage, index) => {
              const order = stage.enabled ? enabledStages.indexOf(stage) + 1 : null;
              return (
                <li
                  key={stage.key}
                  className={`flex flex-col gap-3 rounded-md border px-4 py-3 sm:flex-row sm:items-center ${
                    stage.enabled ? 'border-gray-200 bg-white' : 'border-dashed border-gray-200 bg-gray-50'
                  }`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    stage.enabled ? 'bg-[#ffe100] text-black' : 'bg-gray-200 text-gray-500'
                  }`}
                  >
                    {order ?? '—'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-bold ${stage.enabled ? 'text-gray-900' : 'text-gray-500'}`}>
                      {STAGE_LABELS[stage.key]}
                      {!stage.enabled && <span className="ml-2 text-xs font-normal">已跳过</span>}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-gray-500">{STAGE_HINTS[stage.key]}</p>
                    {stage.key === 'ai' && stage.enabled && (
                      <label className="mt-2 flex items-start gap-2 text-xs leading-5 text-gray-700">
                        <input
                          type="checkbox"
                          checked={Boolean(stage.require_knowledge_hit)}
                          onChange={event => patchStage(index, { require_knowledge_hit: event.target.checked })}
                          className="mt-0.5 h-4 w-4 accent-amber-500"
                        />
                        知识库没有相关资料时 AI 不回答，交给下一个环节（议价消息不受影响）
                      </label>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40"
                      title="上移"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === config.stages.length - 1}
                      className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40"
                      title="下移"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <label className="ml-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                      <input
                        type="checkbox"
                        checked={stage.enabled}
                        onChange={event => patchStage(index, { enabled: event.target.checked })}
                        className="h-4 w-4 accent-amber-500"
                      />
                      启用
                    </label>
                  </div>
                </li>
              );
            })}
          </ol>

          {enabledStages.length === 0 && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              所有环节都已停用，该账号不会自动回复任何咨询。
            </p>
          )}
          {defaultBlocksLater && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              默认回复排在前面且没有开启“只回复一次”，每条消息都会被它回复，后面的环节不会执行。
              可以在“账号默认回复”里开启“只回复一次”，或把默认回复移到最后。
            </p>
          )}
        </div>
      </section>

      <section className="section-panel">
        <SectionHeader
          title="闲鱼 App 离线自动回复"
          description="在闲鱼 App 里开启了离线自动回复时，它发出的消息会出现在卖家账号名下，这里决定系统如何对待它。"
          icon={Smartphone}
        />
        <div className="space-y-4 p-5">
          <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="离线自动回复处理方式">
            {NATIVE_MODE_OPTIONS.map(option => {
              const active = config.native_auto_reply_mode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setConfig({ ...config, native_auto_reply_mode: option.id })}
                  className={`rounded-md border px-3 py-2.5 text-left ${
                    active ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="block text-sm font-bold text-gray-900">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-gray-500">{option.description}</span>
                </button>
              );
            })}
          </div>
          {waitsForNative && (
            <label className="block max-w-md">
              <span className="field-label">识别时间窗口（秒）</span>
              <input
                type="number"
                min={1}
                max={15}
                step={0.5}
                value={config.native_auto_reply_window_seconds}
                onChange={event => setConfig({ ...config, native_auto_reply_window_seconds: Number(event.target.value) })}
                className="ios-input w-full rounded-md px-3 py-2.5 text-sm"
              />
              <span className="mt-1 block text-xs leading-5 text-gray-500">
                买家发消息后这么多秒内由卖家账号发出的消息，视为闲鱼离线自动回复；超过的视为你本人回复，会暂停该会话的自动回复。
                系统也会至少等这么久再回复，保证闲鱼的自动回复排在前面。
              </span>
            </label>
          )}
        </div>
      </section>
    </div>
  );
};

export default ReplyPipelinePanel;
