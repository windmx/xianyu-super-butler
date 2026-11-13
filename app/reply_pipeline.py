"""每个账号的自动回复顺序，以及闲鱼自带离线自动回复的处理方式。

没有保存过配置的账号使用 DEFAULT_STAGE_ORDER，与引入本配置之前的写死顺序一致：
关键词 → AI → 指定商品回复 → 默认回复。
"""

import copy
from typing import Any, Dict, List

STAGE_KEYWORD = 'keyword'
STAGE_AI = 'ai'
STAGE_ITEM_REPLY = 'item_reply'
STAGE_DEFAULT = 'default'

DEFAULT_STAGE_ORDER = (STAGE_KEYWORD, STAGE_AI, STAGE_ITEM_REPLY, STAGE_DEFAULT)

# 闲鱼离线自动回复的处理方式
NATIVE_CONTINUE = 'continue'  # 闲鱼先回，系统接着回
NATIVE_YIELD = 'yield'        # 闲鱼回了，系统这条就不回
NATIVE_LEGACY = 'legacy'      # 当作人工接管（旧行为）
NATIVE_MODES = (NATIVE_CONTINUE, NATIVE_YIELD, NATIVE_LEGACY)

DEFAULT_NATIVE_WINDOW_SECONDS = 3.0
MIN_NATIVE_WINDOW_SECONDS = 1.0
MAX_NATIVE_WINDOW_SECONDS = 15.0

PRESETS: Dict[str, List[str]] = {
    'keyword_first': [STAGE_KEYWORD, STAGE_AI, STAGE_ITEM_REPLY, STAGE_DEFAULT],
    'ai_first': [STAGE_AI, STAGE_KEYWORD, STAGE_ITEM_REPLY, STAGE_DEFAULT],
    'fixed_only': [STAGE_KEYWORD, STAGE_ITEM_REPLY, STAGE_DEFAULT],
    'greeting_first': [STAGE_DEFAULT, STAGE_KEYWORD, STAGE_AI, STAGE_ITEM_REPLY],
}


def default_config() -> Dict[str, Any]:
    return {
        'preset': 'keyword_first',
        'stages': [
            {'key': key, 'enabled': True, **({'require_knowledge_hit': False} if key == STAGE_AI else {})}
            for key in DEFAULT_STAGE_ORDER
        ],
        'native_auto_reply_mode': NATIVE_CONTINUE,
        'native_auto_reply_window_seconds': DEFAULT_NATIVE_WINDOW_SECONDS,
    }


def normalize_config(raw: Any) -> Dict[str, Any]:
    """把任意输入整理成合法配置：未知环节丢弃，缺失环节以停用状态补到末尾。"""
    config = default_config()
    if not isinstance(raw, dict):
        return config

    stages: List[Dict[str, Any]] = []
    seen = set()
    for stage in raw.get('stages') or []:
        if not isinstance(stage, dict):
            continue
        key = stage.get('key')
        if key not in DEFAULT_STAGE_ORDER or key in seen:
            continue
        seen.add(key)
        item = {'key': key, 'enabled': bool(stage.get('enabled', True))}
        if key == STAGE_AI:
            item['require_knowledge_hit'] = bool(stage.get('require_knowledge_hit', False))
        stages.append(item)
    if stages:
        for key in DEFAULT_STAGE_ORDER:
            if key not in seen:
                item = {'key': key, 'enabled': False}
                if key == STAGE_AI:
                    item['require_knowledge_hit'] = False
                stages.append(item)
        config['stages'] = stages

    preset = raw.get('preset')
    if isinstance(preset, str) and (preset in PRESETS or preset == 'custom'):
        config['preset'] = preset

    mode = raw.get('native_auto_reply_mode')
    if mode in NATIVE_MODES:
        config['native_auto_reply_mode'] = mode

    try:
        window = float(raw.get('native_auto_reply_window_seconds', DEFAULT_NATIVE_WINDOW_SECONDS))
    except (TypeError, ValueError):
        window = DEFAULT_NATIVE_WINDOW_SECONDS
    config['native_auto_reply_window_seconds'] = min(
        max(window, MIN_NATIVE_WINDOW_SECONDS), MAX_NATIVE_WINDOW_SECONDS
    )
    return config


def load_config(cookie_id: str) -> Dict[str, Any]:
    from app.db_manager import db_manager

    try:
        raw = db_manager.get_reply_pipeline_config(cookie_id)
    except Exception:
        raw = None
    return normalize_config(raw) if raw else default_config()


def enabled_stages(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [copy.deepcopy(stage) for stage in config.get('stages', []) if stage.get('enabled')]


def waits_for_native_reply(config: Dict[str, Any]) -> bool:
    return config.get('native_auto_reply_mode') in (NATIVE_CONTINUE, NATIVE_YIELD)
