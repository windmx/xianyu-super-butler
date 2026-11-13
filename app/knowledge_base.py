"""AI 知识库检索。

每个账号的条目规模在几十到几百条，项目还要跑在 NAS 上，所以用本地打分而不是
向量库：触发词命中 + 中文二元组重合度。换成 embedding 检索只需替换 retrieve。
"""

import re
from typing import Dict, Iterable, List, Optional, Set

from loguru import logger

MAX_MATCHED_ENTRIES = 5
MAX_TOTAL_CHARS = 1500
MAX_ENTRY_CHARS = 600
MIN_MATCH_SCORE = 2

KEYWORD_SCORE = 10
TITLE_OVERLAP_WEIGHT = 2
ITEM_SCOPE_BONUS = 3

_KEYWORD_SPLIT = re.compile(r'[,，、;；\s]+')
_CJK_RUN = re.compile(r'[\u4e00-\u9fff]+')
_WORD = re.compile(r'[a-z0-9]{2,}')

# 寒暄和语气词组成的二元组，几乎每条消息都有，算进重合度只会带来噪音
_STOP_BIGRAMS = frozenset({
    '你好', '在吗', '请问', '这个', '那个', '可以', '一下', '什么', '怎么', '是不',
    '不是', '有没', '没有', '我想', '想问', '老板', '亲亲', '谢谢', '好的', '还有',
    '吗吗', '的吗', '了吗', '呢吗',
})


def _tokens(text: str) -> Set[str]:
    lowered = (text or '').lower()
    tokens = set(_WORD.findall(lowered))
    for run in _CJK_RUN.findall(lowered):
        if len(run) == 1:
            continue
        for i in range(len(run) - 1):
            bigram = run[i:i + 2]
            if bigram not in _STOP_BIGRAMS:
                tokens.add(bigram)
    return tokens


def split_keywords(raw: str) -> List[str]:
    return [kw for kw in (part.strip() for part in _KEYWORD_SPLIT.split(raw or '')) if kw]


def score_entry(entry: Dict, message: str, message_tokens: Optional[Set[str]] = None) -> int:
    lowered = (message or '').lower()
    tokens = message_tokens if message_tokens is not None else _tokens(message)
    score = 0
    for keyword in split_keywords(entry.get('keywords', '')):
        if keyword.lower() in lowered:
            score += KEYWORD_SCORE
    score += TITLE_OVERLAP_WEIGHT * len(tokens & _tokens(entry.get('title', '')))
    score += len(tokens & _tokens(entry.get('content', '')))
    return score


def _in_scope(entry: Dict, item_id: Optional[str]) -> bool:
    scoped_item = entry.get('item_id') or ''
    return not scoped_item or (item_id is not None and scoped_item == str(item_id))


def rank_entries(entries: Iterable[Dict], item_id: Optional[str], message: str) -> List[Dict]:
    """选出要交给模型的条目，置顶的在前，按长度预算截断。

    返回的每一项带 reason：pinned（置顶，每次都带）或 matched（与本条消息相关）。
    """
    message_tokens = _tokens(message)
    pinned: List[Dict] = []
    matched: List[Dict] = []
    for entry in entries:
        if not entry.get('enabled', True) or not _in_scope(entry, item_id):
            continue
        if entry.get('pinned'):
            pinned.append({**entry, 'score': 0, 'reason': 'pinned'})
            continue
        score = score_entry(entry, message, message_tokens)
        if score < MIN_MATCH_SCORE:
            continue
        if entry.get('item_id'):
            score += ITEM_SCOPE_BONUS
        matched.append({**entry, 'score': score, 'reason': 'matched'})

    # 商品专属的置顶条目排在全店通用的前面
    pinned.sort(key=lambda e: (0 if e.get('item_id') else 1, -int(e.get('id') or 0)))
    matched.sort(key=lambda e: (-e['score'], -int(e.get('id') or 0)))

    selected: List[Dict] = []
    budget = MAX_TOTAL_CHARS
    for entry in pinned + matched[:MAX_MATCHED_ENTRIES]:
        content = (entry.get('content') or '').strip()[:MAX_ENTRY_CHARS]
        cost = len(entry.get('title') or '') + len(content)
        if cost > budget:
            continue
        budget -= cost
        selected.append({**entry, 'content': content})
    return selected


def retrieve(cookie_id: str, item_id: Optional[str], message: str) -> List[Dict]:
    from app.db_manager import db_manager

    try:
        entries = db_manager.list_knowledge_entries(cookie_id, enabled_only=True)
    except Exception as e:
        logger.error(f"读取知识库失败 {cookie_id}: {type(e).__name__}: {e}")
        return []
    if not entries:
        return []
    return rank_entries(entries, item_id, message)


def has_match(selected: List[Dict]) -> bool:
    return any(entry.get('reason') == 'matched' for entry in selected)


def format_for_prompt(selected: List[Dict]) -> str:
    if not selected:
        return ''
    lines = []
    for index, entry in enumerate(selected, 1):
        lines.append(f"{index}. {entry.get('title', '').strip()}：{entry.get('content', '').strip()}")
    return "\n".join(lines)
