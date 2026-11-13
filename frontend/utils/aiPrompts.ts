/**
 * AI 提示词配置与 ai_reply_settings.custom_prompts 字段之间的转换。
 *
 * 与后端 AIReplyEngine.parse_custom_prompts / serialize_custom_prompts 保持一致：
 * 字段为空表示全部使用内置提示词；旧版纯文本整段视为「补充规则」。
 */

import { AIPromptConfig, PromptIntent } from '../types';

export const PROMPT_INTENTS: Array<{ id: PromptIntent; label: string; hint: string }> = [
  { id: 'default', label: '通用客服', hint: '大部分咨询使用，例如商品介绍、物流、售后。' },
  { id: 'price', label: '议价', hint: '买家砍价、问最低价或直接报价时使用。' },
  { id: 'tech', label: '使用问题', hint: '买家问用法、参数、故障时使用。' },
];

export const INTENT_LABELS: Record<string, string> = {
  default: '通用客服',
  price: '议价',
  tech: '使用问题',
};

export const emptyPromptConfig = (): AIPromptConfig => ({
  default: '',
  price: '',
  tech: '',
  extra_rules: '',
});

export const parsePromptConfig = (raw: string | undefined | null): AIPromptConfig => {
  const result = emptyPromptConfig();
  const text = (raw || '').trim();
  if (!text) return result;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      (Object.keys(result) as Array<keyof AIPromptConfig>).forEach(key => {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === 'string') result[key] = value.trim();
      });
      return result;
    }
  } catch {
    // 旧版纯文本
  }
  result.extra_rules = text;
  return result;
};

export const serializePromptConfig = (config: AIPromptConfig): string => {
  const trimmed = emptyPromptConfig();
  (Object.keys(trimmed) as Array<keyof AIPromptConfig>).forEach(key => {
    trimmed[key] = (config[key] || '').trim();
  });
  return Object.values(trimmed).some(Boolean) ? JSON.stringify(trimmed) : '';
};
