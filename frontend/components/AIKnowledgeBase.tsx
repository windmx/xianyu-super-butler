import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Edit2, Pin, Plus, Power, PowerOff, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { Item, KnowledgeEntry, KnowledgeHit } from '../types';
import {
  createKnowledgeEntry,
  deleteKnowledgeEntries,
  getKnowledgeEntries,
  importKnowledgeEntries,
  KnowledgeEntryInput,
  matchKnowledge,
  updateKnowledgeEntry,
} from '../services/api';
import { apiErrorMessage, confirmAction, notify } from '../services/feedback';
import { EmptyState, PageLoading, SectionHeader } from './ui';

interface AIKnowledgeBaseProps {
  cookieId: string;
  items: Item[];
}

type ScopeFilter = 'all' | 'shop' | 'item';

const emptyForm = (): KnowledgeEntryInput => ({
  title: '',
  keywords: '',
  content: '',
  item_id: '',
  pinned: false,
  enabled: true,
});

const IMPORT_PLACEHOLDER = [
  '# 每行一条：标题 | 内容，# 开头的行会被忽略',
  '发货时间 | 每天 18 点前付款当天发货，节假日顺延',
  '售后 | 收到 7 天内有质量问题可退换，需要拍照说明',
].join('\n');

export const ItemScopeSelect: React.FC<{
  id?: string;
  value: string;
  items: Item[];
  onChange: (value: string) => void;
  emptyLabel?: string;
}> = ({ id, value, items, onChange, emptyLabel = '全店通用' }) => {
  const known = items.some(item => item.item_id === value);
  return (
    <select id={id} value={value} onChange={event => onChange(event.target.value)} className="ios-input w-full rounded-md px-3 py-2.5 text-sm">
      <option value="">{emptyLabel}</option>
      {value && !known && <option value={value}>商品 {value}</option>}
      {items.map(item => (
        <option key={item.item_id} value={item.item_id}>
          {item.item_title || item.item_id}
        </option>
      ))}
    </select>
  );
};

const AIKnowledgeBase: React.FC<AIKnowledgeBaseProps> = ({ cookieId, items }) => {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ScopeFilter>('all');

  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<KnowledgeEntryInput>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importItemId, setImportItemId] = useState('');
  const [importPinned, setImportPinned] = useState(false);

  const [matchMessage, setMatchMessage] = useState('');
  const [matchItemId, setMatchItemId] = useState('');
  const [matchResult, setMatchResult] = useState<{ matched: boolean; entries: KnowledgeHit[] } | null>(null);
  const [matching, setMatching] = useState(false);

  const itemTitles = useMemo(
    () => Object.fromEntries(items.map(item => [item.item_id, item.item_title || item.item_id])),
    [items],
  );

  const load = async () => {
    setLoading(true);
    try {
      setEntries(await getKnowledgeEntries(cookieId));
    } catch (error) {
      notify(apiErrorMessage(error, '加载知识库失败'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMatchResult(null);
    void load();
  }, [cookieId]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return entries.filter(entry => {
      if (scope === 'shop' && entry.item_id) return false;
      if (scope === 'item' && !entry.item_id) return false;
      if (!keyword) return true;
      return [entry.title, entry.keywords, entry.content].some(text => text.toLowerCase().includes(keyword));
    });
  }, [entries, query, scope]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (entry: KnowledgeEntry) => {
    setEditing(entry);
    setForm({
      title: entry.title,
      keywords: entry.keywords,
      content: entry.content,
      item_id: entry.item_id,
      pinned: entry.pinned,
      enabled: entry.enabled,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      notify('请填写标题和内容', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, title: form.title.trim(), content: form.content.trim(), keywords: form.keywords.trim() };
      if (editing) {
        await updateKnowledgeEntry(cookieId, editing.id, payload);
      } else {
        await createKnowledgeEntry(cookieId, payload);
      }
      notify(editing ? '知识条目已更新' : '知识条目已添加', 'success');
      setShowForm(false);
      await load();
    } catch (error) {
      notify(apiErrorMessage(error, '保存知识条目失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (entry: KnowledgeEntry) => {
    try {
      await updateKnowledgeEntry(cookieId, entry.id, { enabled: !entry.enabled });
      setEntries(current => current.map(item => (item.id === entry.id ? { ...item, enabled: !entry.enabled } : item)));
    } catch (error) {
      notify(apiErrorMessage(error, '更新状态失败'), 'error');
    }
  };

  const handleDelete = async (entry: KnowledgeEntry) => {
    const confirmed = await confirmAction(`确定删除“${entry.title}”吗？`, {
      title: '删除知识条目',
      confirmLabel: '删除',
    });
    if (!confirmed) return;
    try {
      await deleteKnowledgeEntries(cookieId, [entry.id]);
      setEntries(current => current.filter(item => item.id !== entry.id));
      notify('知识条目已删除', 'success');
    } catch (error) {
      notify(apiErrorMessage(error, '删除知识条目失败'), 'error');
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) {
      notify('请粘贴要导入的内容', 'error');
      return;
    }
    setSaving(true);
    try {
      const result = await importKnowledgeEntries(cookieId, { text: importText, item_id: importItemId, pinned: importPinned });
      const skipped = result.invalid_lines.length
        ? `，第 ${result.invalid_lines.slice(0, 10).join('、')}${result.invalid_lines.length > 10 ? ' 等' : ''} 行格式不对已跳过`
        : '';
      notify(`已导入 ${result.imported} 条${skipped}`, result.imported ? 'success' : 'error');
      if (result.imported) {
        setShowImport(false);
        setImportText('');
        await load();
      }
    } catch (error) {
      notify(apiErrorMessage(error, '导入失败'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMatch = async () => {
    if (!matchMessage.trim()) return;
    setMatching(true);
    try {
      setMatchResult(await matchKnowledge(cookieId, { message: matchMessage.trim(), item_id: matchItemId }));
    } catch (error) {
      notify(apiErrorMessage(error, '命中测试失败'), 'error');
    } finally {
      setMatching(false);
    }
  };

  const toggleSwitch = (checked: boolean, onChange: (value: boolean) => void, label: string) => (
    <label className="flex items-center justify-between gap-4 rounded-md border border-gray-200 px-3 py-2.5">
      <span className="text-sm font-semibold text-gray-700">{label}</span>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="h-4 w-4 accent-amber-500" />
    </label>
  );

  return (
    <div className="space-y-5">
      <section className="section-panel">
        <SectionHeader
          title="店铺知识库"
          description="AI 回复前会按买家消息找出最相关的几条资料，作为回答依据。置顶条目每次都会带上。"
          icon={BookOpen}
          actions={(
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setShowImport(true)} className="ios-btn-secondary flex items-center gap-1.5 rounded-md px-3 py-2 text-sm">
                <Upload className="h-4 w-4" />
                批量导入
              </button>
              <button type="button" onClick={openCreate} className="ios-btn-primary flex items-center gap-1.5 rounded-md px-3 py-2 text-sm">
                <Plus className="h-4 w-4" />
                新增条目
              </button>
            </div>
          )}
        />
        <div className="flex flex-col gap-2 border-b border-gray-100 px-5 py-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索标题、关键词或内容"
              className="ios-input w-full rounded-md py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <select value={scope} onChange={event => setScope(event.target.value as ScopeFilter)} className="ios-input rounded-md px-3 py-2 text-sm sm:w-40" aria-label="适用范围">
            <option value="all">全部范围</option>
            <option value="shop">全店通用</option>
            <option value="item">指定商品</option>
          </select>
        </div>

        {loading ? (
          <PageLoading label="正在加载知识库" />
        ) : visible.length === 0 ? (
          <EmptyState
            compact
            title={entries.length ? '没有符合条件的条目' : '知识库还是空的'}
            description={entries.length ? '换个关键词或范围试试。' : '把发货时间、售后政策、商品参数等常见问题的答案录进来，AI 会据此回答。'}
            icon={BookOpen}
          />
        ) : (
          <div className="divide-y divide-gray-100">
            {visible.map(entry => (
              <article key={entry.id} className={`grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] ${entry.enabled ? '' : 'opacity-60'}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words text-sm font-bold text-gray-900">{entry.title}</h3>
                    {entry.pinned && (
                      <span className="status-badge status-badge-info flex items-center gap-1">
                        <Pin className="h-3 w-3" />
                        置顶
                      </span>
                    )}
                    <span className="status-badge bg-gray-100 text-gray-600">
                      {entry.item_id ? `商品：${itemTitles[entry.item_id] || entry.item_id}` : '全店通用'}
                    </span>
                    {!entry.enabled && <span className="status-badge bg-gray-100 text-gray-600">已停用</span>}
                  </div>
                  {entry.keywords && <p className="mt-1 text-xs text-gray-500">关键词：{entry.keywords}</p>}
                  <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-gray-600">{entry.content}</p>
                </div>
                <div className="flex items-start justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleToggle(entry)}
                    className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                    title={entry.enabled ? '停用' : '启用'}
                  >
                    {entry.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(entry)}
                    className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                    title="编辑"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(entry)}
                    className="flex h-9 w-9 items-center justify-center rounded-md bg-red-50 text-red-600 hover:bg-red-100"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section-panel">
        <SectionHeader title="命中测试" description="不调用大模型，只看一条买家消息会带上哪些资料。" icon={Search} />
        <div className="space-y-3 p-5">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
            <input
              value={matchMessage}
              onChange={event => setMatchMessage(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void handleMatch(); }}
              placeholder="例如：今天下单什么时候发货"
              className="ios-input rounded-md px-3 py-2 text-sm"
            />
            <ItemScopeSelect value={matchItemId} items={items} onChange={setMatchItemId} emptyLabel="不指定商品" />
            <button
              type="button"
              onClick={() => void handleMatch()}
              disabled={matching || !matchMessage.trim()}
              className="ios-btn-secondary rounded-md px-4 py-2 text-sm"
            >
              {matching ? '测试中…' : '测试'}
            </button>
          </div>
          {matchResult && (
            matchResult.entries.length ? (
              <ul className="space-y-1.5">
                {matchResult.entries.map(hit => (
                  <li key={hit.id} className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-gray-800">{hit.title}</span>
                    <span className={`status-badge ${hit.reason === 'pinned' ? 'status-badge-info' : 'status-badge-success'}`}>
                      {hit.reason === 'pinned' ? '置顶' : '命中'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">没有命中任何条目。可以给相关条目补充关键词。</p>
            )
          )}
        </div>
      </section>

      {showForm && createPortal(
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{editing ? '编辑知识条目' : '新增知识条目'}</h3>
                <p className="mt-1 text-sm text-gray-500">标题和关键词决定什么时候带上这条资料，内容是 AI 回答的依据。</p>
              </div>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-md p-2 hover:bg-gray-100" aria-label="关闭">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="modal-body space-y-4">
              <label className="block">
                <span className="field-label">标题</span>
                <input
                  value={form.title}
                  onChange={event => setForm({ ...form, title: event.target.value })}
                  maxLength={120}
                  placeholder="例如：发货时间"
                  className="ios-input w-full rounded-md px-3 py-2.5"
                />
              </label>
              <label className="block">
                <span className="field-label">关键词（可选，用逗号或空格分隔）</span>
                <input
                  value={form.keywords}
                  onChange={event => setForm({ ...form, keywords: event.target.value })}
                  maxLength={300}
                  placeholder="例如：几天到, 什么时候发, 快递"
                  className="ios-input w-full rounded-md px-3 py-2.5"
                />
              </label>
              <label className="block">
                <span className="field-label">内容</span>
                <textarea
                  value={form.content}
                  onChange={event => setForm({ ...form, content: event.target.value })}
                  maxLength={2000}
                  rows={6}
                  placeholder="写清楚事实即可，AI 会自己组织语言。"
                  className="ios-input w-full resize-y rounded-md px-3 py-2.5"
                />
              </label>
              <label className="block">
                <span className="field-label">适用范围</span>
                <ItemScopeSelect value={form.item_id} items={items} onChange={value => setForm({ ...form, item_id: value })} />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {toggleSwitch(form.pinned, value => setForm({ ...form, pinned: value }), '置顶（每次都带上）')}
                {toggleSwitch(form.enabled, value => setForm({ ...form, enabled: value }), '启用')}
              </div>
            </div>
            <div className="modal-footer flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="ios-btn-secondary rounded-md px-4 py-2.5">取消</button>
              <button type="button" onClick={() => void handleSave()} disabled={saving} className="ios-btn-primary flex items-center gap-2 rounded-md px-4 py-2.5">
                <Save className="h-4 w-4" />
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showImport && createPortal(
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">批量导入</h3>
                <p className="mt-1 text-sm text-gray-500">每行一条“标题 | 内容”，也支持 Tab 或中文冒号分隔。</p>
              </div>
              <button type="button" onClick={() => setShowImport(false)} className="rounded-md p-2 hover:bg-gray-100" aria-label="关闭">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="modal-body space-y-4">
              <textarea
                value={importText}
                onChange={event => setImportText(event.target.value)}
                rows={10}
                placeholder={IMPORT_PLACEHOLDER}
                className="ios-input w-full resize-y rounded-md px-3 py-2.5 font-mono text-sm"
              />
              <label className="block">
                <span className="field-label">适用范围</span>
                <ItemScopeSelect value={importItemId} items={items} onChange={setImportItemId} />
              </label>
              {toggleSwitch(importPinned, setImportPinned, '导入为置顶条目')}
            </div>
            <div className="modal-footer flex justify-end gap-2">
              <button type="button" onClick={() => setShowImport(false)} className="ios-btn-secondary rounded-md px-4 py-2.5">取消</button>
              <button type="button" onClick={() => void handleImport()} disabled={saving} className="ios-btn-primary flex items-center gap-2 rounded-md px-4 py-2.5">
                <Upload className="h-4 w-4" />
                {saving ? '导入中…' : '导入'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default AIKnowledgeBase;
