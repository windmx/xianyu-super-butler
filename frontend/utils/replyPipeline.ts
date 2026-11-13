import { NativeAutoReplyMode, ReplyPipelineConfig, ReplyStageKey } from '../types';

/** 页面切换时组件不卸载，回复顺序保存后用这个事件通知 AI 回复页刷新展示。 */
export const REPLY_PIPELINE_CHANGED_EVENT = 'app:reply-pipeline-changed';

export const STAGE_LABELS: Record<ReplyStageKey, string> = {
  keyword: '关键词回复',
  ai: 'AI 回复',
  item_reply: '指定商品回复',
  default: '默认回复',
};

export const STAGE_HINTS: Record<ReplyStageKey, string> = {
  keyword: '买家消息包含关键词时，用设定的内容回复。',
  ai: '由大模型结合商品信息和知识库生成回复。',
  item_reply: '在“商品与发货”里给单个商品配置的固定回复。',
  default: '账号默认回复；开启“只回复一次”时每个会话只发一次。',
};

export const PRESET_OPTIONS: Array<{ id: string; label: string; description: string }> = [
  { id: 'keyword_first', label: '关键词优先', description: '先用固定话术，没命中再交给 AI。' },
  { id: 'ai_first', label: 'AI 优先', description: '所有咨询先交给 AI，AI 失败再用固定话术。' },
  { id: 'fixed_only', label: '仅固定话术', description: '不使用 AI。' },
  { id: 'greeting_first', label: '问候在前', description: '先发默认回复，适合配合“只回复一次”做开场问候。' },
  { id: 'custom', label: '自定义', description: '手动调整顺序和开关。' },
];

export const NATIVE_MODE_OPTIONS: Array<{ id: NativeAutoReplyMode; label: string; description: string }> = [
  {
    id: 'continue',
    label: '闲鱼先回，系统接着回',
    description: '闲鱼 App 的离线自动回复不算人工接管，系统在它之后照常回复。',
  },
  {
    id: 'yield',
    label: '闲鱼回了，系统这条就不回',
    description: '闲鱼已经自动回复的那条买家消息，系统不再重复回复；之后的消息照常处理。',
  },
  {
    id: 'legacy',
    label: '当作人工接管',
    description: '与旧版本一致：卖家账号发出的任何消息都会暂停该会话的自动回复。',
  },
];

export const describeStageOrder = (config: ReplyPipelineConfig | null): string => {
  if (!config) return '';
  const enabled = config.stages.filter(stage => stage.enabled).map(stage => STAGE_LABELS[stage.key]);
  return enabled.length ? enabled.join(' → ') : '所有回复环节均已停用';
};
