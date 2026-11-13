import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  MessageSquareText,
  Play,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { AccountDetail, AIPromptConfig, AIPromptDefaults, AIReplySettings, Item, KnowledgeHit, ReplyPipelineConfig } from '../types';
import {
  getAccountAISettings,
  getAccountDetails,
  getAIPromptDefaults,
  getItems,
  getReplyPipeline,
  testAIConnection,
  updateAccountAISettings,
} from '../services/api';
import { apiErrorMessage, notify } from '../services/feedback';
import { emptyPromptConfig, INTENT_LABELS, parsePromptConfig, serializePromptConfig } from '../utils/aiPrompts';
import { describeStageOrder, NATIVE_MODE_OPTIONS, REPLY_PIPELINE_CHANGED_EVENT } from '../utils/replyPipeline';
import AIKnowledgeBase, { ItemScopeSelect } from './AIKnowledgeBase';
import AIPromptEditor from './AIPromptEditor';
import { EmptyState, PageHeader, PageLoading, PageTabs, SectionHeader } from './ui';

type AIReplyTab = 'model' | 'prompts' | 'knowledge';

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

const defaultSettings: AIReplySettings = {
  ai_enabled: false,
  model_name: 'deepseek-chat',
  api_key: '',
  api_key_configured: false,
  base_url: DEFAULT_BASE_URL,
  user_agent: 'codex_cli_rs/0.0.0 (Hermes Agent)',
  max_discount_percent: 10,
  max_discount_amount: 100,
  max_bargain_rounds: 3,
  context_enabled: true,
  context_message_limit: 12,
  context_expire_minutes: 120,
  custom_prompts: '',
};

const AIReply: React.FC = () => {
  const [accounts, setAccounts] = useState<AccountDetail[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [settings, setSettings] = useState<AIReplySettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testMessage, setTestMessage] = useState('你好，这个商品现在还能买吗？');
  const [testItemId, setTestItemId] = useState('');
  const [testReply, setTestReply] = useState('');
  const [testIntent, setTestIntent] = useState('');
  const [testKnowledge, setTestKnowledge] = useState<KnowledgeHit[]>([]);
  const [tab, setTab] = useState<AIReplyTab>('model');
  const [prompts, setPrompts] = useState<AIPromptConfig>(emptyPromptConfig());
  const [promptDefaults, setPromptDefaults] = useState<AIPromptDefaults | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [pipeline, setPipeline] = useState<ReplyPipelineConfig | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find(account => account.id === selectedAccountId),
    [accounts, selectedAccountId],
  );
  const accountItems = useMemo(
    () => items.filter(item => item.cookie_id === selectedAccountId),
    [items, selectedAccountId],
  );
  const customizedPromptCount = Object.values(prompts).filter(Boolean).length;

  useEffect(() => {
    getAccountDetails()
      .then(data => {
        setAccounts(data);
        setSelectedAccountId(data[0]?.id || '');
      })
      .catch(error => notify(error instanceof Error ? error.message : '账号加载失败', 'error'))
      .finally(() => setLoading(false));
    getAIPromptDefaults().then(setPromptDefaults).catch(() => setPromptDefaults(null));
    getItems().then(setItems).catch(() => setItems([]));
  }, []);

  const applySettings = (data: AIReplySettings) => {
    setSettings({ ...defaultSettings, ...data, api_key: '' });
    setPrompts(parsePromptConfig(data.custom_prompts));
  };

  const loadPipeline = (cookieId: string) => {
    getReplyPipeline(cookieId)
      .then(result => setPipeline(result.config))
      .catch(() => setPipeline(null));
  };

  useEffect(() => {
    if (!selectedAccountId) return;
    setLoading(true);
    setTestReply('');
    setTestIntent('');
    setTestKnowledge([]);
    setTestItemId('');
    setShowApiKey(false);
    getAccountAISettings(selectedAccountId)
      .then(applySettings)
      .catch(error => notify(error instanceof Error ? error.message : 'AI配置加载失败', 'error'))
      .finally(() => setLoading(false));
    loadPipeline(selectedAccountId);
  }, [selectedAccountId]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const cookieId = (event as CustomEvent<string>).detail;
      if (cookieId === selectedAccountId) loadPipeline(cookieId);
    };
    window.addEventListener(REPLY_PIPELINE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(REPLY_PIPELINE_CHANGED_EVENT, onChanged);
  }, [selectedAccountId]);

  const updateSetting = <K extends keyof AIReplySettings>(key: K, value: AIReplySettings[K]) => {
    setSettings(current => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!selectedAccountId) {
      notify('请先选择账号', 'warning');
      return;
    }
    if (!settings.model_name.trim() || !settings.base_url.trim()) {
      notify('模型名称和接口地址不能为空', 'warning');
      return;
    }

    setSaving(true);
    try {
      await updateAccountAISettings(selectedAccountId, { ...settings, custom_prompts: serializePromptConfig(prompts) });
      applySettings(await getAccountAISettings(selectedAccountId));
      notify('人工智能回复配置已保存', 'success');
    } catch (error) {
      notify(apiErrorMessage(error, 'AI配置保存失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!selectedAccountId || !testMessage.trim()) {
      notify('请选择账号并输入测试消息', 'warning');
      return;
    }
    setTesting(true);
    setTestReply('');
    setTestIntent('');
    setTestKnowledge([]);
    const item = accountItems.find(candidate => candidate.item_id === testItemId);
    const price = Number.parseFloat(String(item?.item_price ?? '').replace(/[^\d.]/g, ''));
    try {
      const result = await testAIConnection(selectedAccountId, {
        message: testMessage.trim(),
        item_id: item?.item_id,
        item_title: item?.item_title || '测试商品',
        item_price: Number.isFinite(price) ? price : 100,
        item_desc: item?.item_detail || item?.item_description || '仅用于测试人工智能回复，不会发送到闲鱼。',
        custom_prompts: serializePromptConfig(prompts),
      });
      setTestReply(result.reply || result.message || '测试完成');
      setTestIntent(result.intent || '');
      setTestKnowledge(result.knowledge || []);
      notify('AI回复测试完成', 'success');
    } catch (error) {
      notify(apiErrorMessage(error, 'AI回复测试失败'), 'error');
    } finally {
      setTesting(false);
    }
  };

  const nativeModeLabel = NATIVE_MODE_OPTIONS.find(option => option.id === pipeline?.native_auto_reply_mode)?.label;

  if (loading && accounts.length === 0) {
    return <PageLoading label="正在加载 AI 回复配置" />;
  }

  return (
    <div className="page-stack animate-fade-in">
      <PageHeader
        title="AI 回复"
        description="按账号配置模型连接、提示词、店铺知识库和议价边界。"
        icon={Bot}
        actions={(
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <label className="min-w-0 sm:w-72">
              <span className="field-label">当前账号</span>
              <select
                value={selectedAccountId}
                onChange={event => setSelectedAccountId(event.target.value)}
                className="ios-input w-full rounded-md px-3 py-2 text-sm font-semibold"
              >
                {accounts.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.nickname || account.remark || `账号 ${account.id.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </label>
            {tab !== 'knowledge' && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !selectedAccountId}
                className="ios-btn-primary flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? '保存中' : '保存配置'}
              </button>
            )}
          </div>
        )}
      />

      {!selectedAccountId ? (
        <EmptyState
          icon={Bot}
          title="暂无可配置账号"
          description="请先在账号管理中添加并登录闲鱼账号。"
        />
      ) : (
        <>
          <section className="section-panel grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex items-center gap-2 font-bold text-gray-900">
                <MessageSquareText className="h-5 w-5" />
                {selectedAccount?.nickname || selectedAccount?.remark || selectedAccountId}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {pipeline
                  ? `回复顺序：${describeStageOrder(pipeline)}。`
                  : '回复顺序加载中。'}
                {nativeModeLabel && ` 闲鱼离线自动回复：${nativeModeLabel}。`}
                AI 失败时会交给下一个环节。可在“自动回复 → 回复顺序”中调整。
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-3">
              <span className="text-sm font-bold text-gray-700">
                {settings.ai_enabled ? '已启用' : '已停用'}
              </span>
              <input
                type="checkbox"
                checked={settings.ai_enabled}
                onChange={event => updateSetting('ai_enabled', event.target.checked)}
                className="h-5 w-5 accent-yellow-400"
              />
            </label>
          </section>

          <PageTabs
            value={tab}
            onChange={setTab}
            ariaLabel="AI 回复设置"
            items={[
              { id: 'model', label: '模型与策略', icon: SlidersHorizontal },
              { id: 'prompts', label: '提示词', icon: FileText, count: customizedPromptCount || undefined },
              { id: 'knowledge', label: '知识库', icon: BookOpen },
            ]}
          />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
            <div className="space-y-6">
              {tab === 'prompts' && (
                <AIPromptEditor value={prompts} onChange={setPrompts} defaults={promptDefaults} />
              )}
              {tab === 'knowledge' && (
                <AIKnowledgeBase cookieId={selectedAccountId} items={accountItems} />
              )}
              {tab === 'model' && (<>
              <section className="section-panel">
                <SectionHeader
                  title="模型连接"
                  description="支持 OpenAI 兼容接口；密钥留空时保留服务器中已有配置。"
                  icon={Bot}
                />
                <div className="grid gap-4 p-5 md:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-sm font-semibold text-gray-700">接口地址</span>
                    <input
                      value={settings.base_url}
                      onChange={event => updateSetting('base_url', event.target.value)}
                      className="ios-input w-full rounded-md px-3 py-2.5 text-sm"
                      placeholder={DEFAULT_BASE_URL}
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-semibold text-gray-700">模型名称</span>
                    <input
                      value={settings.model_name}
                      onChange={event => updateSetting('model_name', event.target.value)}
                      className="ios-input w-full rounded-md px-3 py-2.5 text-sm"
                      placeholder="deepseek-chat"
                    />
                  </label>
                  <label className="md:col-span-2">
                    <span className="mb-1.5 flex items-center justify-between gap-3 text-sm font-semibold text-gray-700">
                      API Key
                      {settings.api_key_configured && !settings.api_key && (
                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          已配置，留空保持不变
                        </span>
                      )}
                    </span>
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={settings.api_key}
                        onChange={event => updateSetting('api_key', event.target.value)}
                        className="ios-input w-full rounded-md px-3 py-2.5 pr-10 text-sm"
                        placeholder={settings.api_key_configured ? '输入新密钥以替换' : '请输入 API Key'}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(value => !value)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:bg-gray-100"
                        title={showApiKey ? '隐藏密钥' : '显示密钥'}
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </label>
                  <label className="md:col-span-2">
                    <span className="mb-1.5 block text-sm font-semibold text-gray-700">User-Agent</span>
                    <input
                      value={settings.user_agent ?? ''}
                      onChange={event => updateSetting('user_agent', event.target.value)}
                      className="ios-input w-full rounded-md px-3 py-2.5 text-sm"
                      placeholder="codex_cli_rs/0.0.0 (Hermes Agent)"
                    />
                    <span className="mt-1 block text-xs text-gray-500">部分 API 中转站（如 AgentRouter）通过 User-Agent 白名单检测客户端，留空使用默认值。</span>
                  </label>
                </div>
              </section>

              <section className="section-panel">
                <SectionHeader
                  title="议价边界"
                  description="AI 报价不会低于这里的限制；语气和业务规则请到“提示词”页签编辑。"
                  icon={MessageSquareText}
                />
                <div className="grid gap-4 p-5 sm:grid-cols-3">
                  <label>
                    <span className="mb-1.5 block text-sm font-semibold text-gray-700">最大折扣比例</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={settings.max_discount_percent}
                      onChange={event => updateSetting('max_discount_percent', Number(event.target.value))}
                      className="ios-input w-full rounded-md px-3 py-2.5 text-sm"
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-semibold text-gray-700">最大折扣金额</span>
                    <input
                      type="number"
                      min={0}
                      value={settings.max_discount_amount ?? 0}
                      onChange={event => updateSetting('max_discount_amount', Number(event.target.value))}
                      className="ios-input w-full rounded-md px-3 py-2.5 text-sm"
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-semibold text-gray-700">最大议价轮次</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={settings.max_bargain_rounds}
                      onChange={event => updateSetting('max_bargain_rounds', Number(event.target.value))}
                      className="ios-input w-full rounded-md px-3 py-2.5 text-sm"
                    />
                  </label>
                </div>
              </section>

              <section className="section-panel">
                <SectionHeader
                  title="上下文对话"
                  description="控制单个买家会话中可用于连续回复的近期消息范围。"
                  icon={ShieldCheck}
                />
                <div className="grid gap-4 p-5 sm:grid-cols-2">
                  <label className="flex items-center justify-between gap-4 sm:col-span-2">
                    <span>
                      <span className="block text-sm font-semibold text-gray-700">记住近期对话</span>
                      <span className="mt-1 block text-xs leading-5 text-gray-500">
                        上下文按账号、会话和商品隔离，切换商品不会混入旧商品内容。
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.context_enabled}
                      onChange={event => updateSetting('context_enabled', event.target.checked)}
                      className="h-5 w-5 shrink-0 accent-yellow-400"
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-semibold text-gray-700">记忆消息数</span>
                    <input
                      type="number"
                      min={2}
                      max={30}
                      disabled={!settings.context_enabled}
                      value={settings.context_message_limit}
                      onChange={event => updateSetting('context_message_limit', Number(event.target.value))}
                      className="ios-input w-full rounded-md px-3 py-2.5 text-sm disabled:bg-gray-100"
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-semibold text-gray-700">上下文有效期（分钟）</span>
                    <input
                      type="number"
                      min={5}
                      max={1440}
                      disabled={!settings.context_enabled}
                      value={settings.context_expire_minutes}
                      onChange={event => updateSetting('context_expire_minutes', Number(event.target.value))}
                      className="ios-input w-full rounded-md px-3 py-2.5 text-sm disabled:bg-gray-100"
                    />
                  </label>
                  <p className="text-xs leading-5 text-gray-500 sm:col-span-2">
                    付款、发货、退款、收货等系统事件不会交给大模型，将继续由订单状态和自动发货规则处理。
                  </p>
                </div>
              </section>
              </>)}
            </div>

            <aside className="space-y-5">
              <section className="section-panel">
                <SectionHeader
                  title="回复测试"
                  description="使用页面上未保存的提示词生成文本，不会发送到闲鱼会话。"
                  icon={Play}
                />
                <div className="p-5">
                  <textarea
                    value={testMessage}
                    onChange={event => setTestMessage(event.target.value)}
                    className="ios-input min-h-24 w-full resize-y rounded-md px-3 py-2.5 text-sm"
                  />
                  <label className="mt-3 block">
                    <span className="field-label">模拟咨询的商品</span>
                    <ItemScopeSelect value={testItemId} items={accountItems} onChange={setTestItemId} emptyLabel="测试商品（不指定）" />
                  </label>
                  {!settings.ai_enabled && (
                    <p className="mt-2 text-xs text-gray-500">需先启用并保存 AI 回复后才能测试。</p>
                  )}
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={testing || !settings.ai_enabled}
                    className="ios-btn-primary mt-3 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm"
                  >
                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {testing ? '生成中' : '测试回复'}
                  </button>
                  {testReply && (
                    <div className="mt-4 space-y-3">
                      <div className="border-l-4 border-yellow-400 bg-yellow-50 px-4 py-3 text-sm leading-6 text-gray-800">
                        {testReply}
                      </div>
                      <dl className="space-y-1.5 text-xs text-gray-600">
                        {testIntent && (
                          <div className="flex gap-2">
                            <dt className="shrink-0 font-semibold">使用提示词</dt>
                            <dd>{INTENT_LABELS[testIntent] || testIntent}</dd>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <dt className="shrink-0 font-semibold">引用知识</dt>
                          <dd className="min-w-0">
                            {testKnowledge.length
                              ? testKnowledge.map(hit => `${hit.title}${hit.reason === 'pinned' ? '（置顶）' : ''}`).join('、')
                              : '无'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </div>
              </section>

              <section className="section-panel p-5">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  <div>
                    <h2 className="text-sm font-bold text-gray-900">运行保护</h2>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      密钥不会回传到浏览器；接口超时、空回复或格式异常时，系统会按回复顺序交给下一个环节。
                    </p>
                  </div>
                </div>
              </section>
            </aside>
          </div>

        </>
      )}
    </div>
  );
};

export default AIReply;
