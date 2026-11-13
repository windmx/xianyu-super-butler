"""Authenticated management API for the AI knowledge base and per-account reply order."""

from __future__ import annotations

import re
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import knowledge_base, reply_pipeline

MAX_ENTRIES_PER_ACCOUNT = 1000
MAX_IMPORT_LINES = 500


class KnowledgeEntryIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=2000)
    keywords: str = Field(default="", max_length=300)
    item_id: str = Field(default="", max_length=64)
    pinned: bool = False
    enabled: bool = True


class KnowledgeEntryUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    content: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    keywords: Optional[str] = Field(default=None, max_length=300)
    item_id: Optional[str] = Field(default=None, max_length=64)
    pinned: Optional[bool] = None
    enabled: Optional[bool] = None


class KnowledgeImportIn(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)
    item_id: str = Field(default="", max_length=64)
    pinned: bool = False


class KnowledgeMatchIn(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    item_id: str = Field(default="", max_length=64)


class KnowledgeDeleteIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=MAX_ENTRIES_PER_ACCOUNT)


class PipelineStageIn(BaseModel):
    key: str
    enabled: bool = True
    require_knowledge_hit: bool = False


class PipelineConfigIn(BaseModel):
    preset: str = "custom"
    stages: list[PipelineStageIn]
    native_auto_reply_mode: str = reply_pipeline.NATIVE_CONTINUE
    native_auto_reply_window_seconds: float = reply_pipeline.DEFAULT_NATIVE_WINDOW_SECONDS


# 「标题 | 内容」，也接受制表符或冒号分隔；冒号只认第一个，内容里的时间不受影响
_IMPORT_SEPARATORS = (re.compile(r"\s*\|\s*"), re.compile(r"\t+"), re.compile(r"\s*[：:]\s*"))


def parse_import_text(text: str) -> tuple[list[dict[str, str]], list[int]]:
    """把批量导入的文本拆成条目，返回 (条目, 无法解析的行号)。"""
    entries: list[dict[str, str]] = []
    invalid: list[int] = []
    for line_no, raw_line in enumerate((text or "").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        for separator in _IMPORT_SEPARATORS:
            parts = separator.split(line, maxsplit=1)
            if len(parts) == 2 and parts[0].strip() and parts[1].strip():
                entries.append({"title": parts[0].strip()[:120], "content": parts[1].strip()[:2000]})
                break
        else:
            invalid.append(line_no)
    return entries, invalid


def create_ai_knowledge_router(
    get_current_user: Callable[..., dict[str, Any]],
    db_manager: Any,
) -> APIRouter:
    router = APIRouter()

    def require_account(cookie_id: str, current_user: dict[str, Any]) -> None:
        details = db_manager.get_cookie_details(cookie_id)
        if not details or details.get("user_id") != current_user["user_id"]:
            raise HTTPException(status_code=404, detail="账号不存在或无权限")

    def ensure_capacity(cookie_id: str, adding: int) -> None:
        existing = len(db_manager.list_knowledge_entries(cookie_id))
        if existing + adding > MAX_ENTRIES_PER_ACCOUNT:
            raise HTTPException(
                status_code=400,
                detail=f"每个账号最多 {MAX_ENTRIES_PER_ACCOUNT} 条知识，当前已有 {existing} 条",
            )

    @router.get("/ai-knowledge/{cookie_id}")
    def list_entries(cookie_id: str, current_user: dict[str, Any] = Depends(get_current_user)):
        require_account(cookie_id, current_user)
        return {"success": True, "entries": db_manager.list_knowledge_entries(cookie_id)}

    @router.post("/ai-knowledge/{cookie_id}")
    def create_entry(
        cookie_id: str,
        entry: KnowledgeEntryIn,
        current_user: dict[str, Any] = Depends(get_current_user),
    ):
        require_account(cookie_id, current_user)
        ensure_capacity(cookie_id, 1)
        payload = entry.model_dump()
        payload["title"] = payload["title"].strip()
        payload["content"] = payload["content"].strip()
        if not payload["title"] or not payload["content"]:
            raise HTTPException(status_code=400, detail="标题和内容不能为空")
        [entry_id] = db_manager.create_knowledge_entries(cookie_id, [payload])
        return {"success": True, "entry": db_manager.get_knowledge_entry(entry_id)}

    @router.post("/ai-knowledge/{cookie_id}/import")
    def import_entries(
        cookie_id: str,
        payload: KnowledgeImportIn,
        current_user: dict[str, Any] = Depends(get_current_user),
    ):
        require_account(cookie_id, current_user)
        entries, invalid = parse_import_text(payload.text)
        if not entries:
            raise HTTPException(status_code=400, detail="没有可导入的内容，每行格式为「标题 | 内容」")
        if len(entries) > MAX_IMPORT_LINES:
            raise HTTPException(status_code=400, detail=f"单次最多导入 {MAX_IMPORT_LINES} 条")
        ensure_capacity(cookie_id, len(entries))
        for entry in entries:
            entry["item_id"] = payload.item_id.strip()
            entry["pinned"] = payload.pinned
        ids = db_manager.create_knowledge_entries(cookie_id, entries)
        return {"success": True, "imported": len(ids), "invalid_lines": invalid}

    @router.post("/ai-knowledge/{cookie_id}/match")
    def match_entries(
        cookie_id: str,
        payload: KnowledgeMatchIn,
        current_user: dict[str, Any] = Depends(get_current_user),
    ):
        require_account(cookie_id, current_user)
        selected = knowledge_base.retrieve(cookie_id, payload.item_id.strip() or None, payload.message)
        return {
            "success": True,
            "matched": knowledge_base.has_match(selected),
            "entries": [
                {
                    "id": entry.get("id"),
                    "title": entry.get("title"),
                    "reason": entry.get("reason"),
                    "score": entry.get("score"),
                }
                for entry in selected
            ],
        }

    @router.put("/ai-knowledge/{cookie_id}/{entry_id}")
    def update_entry(
        cookie_id: str,
        entry_id: int,
        changes: KnowledgeEntryUpdate,
        current_user: dict[str, Any] = Depends(get_current_user),
    ):
        require_account(cookie_id, current_user)
        fields = changes.model_dump(exclude_unset=True)
        for key in ("title", "content"):
            if key in fields and fields[key] is not None:
                fields[key] = fields[key].strip()
                if not fields[key]:
                    raise HTTPException(status_code=400, detail="标题和内容不能为空")
        if not db_manager.update_knowledge_entry(entry_id, cookie_id, fields):
            raise HTTPException(status_code=404, detail="知识条目不存在")
        return {"success": True, "entry": db_manager.get_knowledge_entry(entry_id)}

    @router.post("/ai-knowledge/{cookie_id}/delete")
    def delete_entries(
        cookie_id: str,
        payload: KnowledgeDeleteIn,
        current_user: dict[str, Any] = Depends(get_current_user),
    ):
        require_account(cookie_id, current_user)
        deleted = db_manager.delete_knowledge_entries(cookie_id, payload.ids)
        return {"success": True, "deleted": deleted}

    @router.get("/reply-pipeline/{cookie_id}")
    def get_pipeline(cookie_id: str, current_user: dict[str, Any] = Depends(get_current_user)):
        require_account(cookie_id, current_user)
        return {
            "success": True,
            "config": reply_pipeline.load_config(cookie_id),
            "presets": reply_pipeline.PRESETS,
        }

    @router.put("/reply-pipeline/{cookie_id}")
    def save_pipeline(
        cookie_id: str,
        payload: PipelineConfigIn,
        current_user: dict[str, Any] = Depends(get_current_user),
    ):
        require_account(cookie_id, current_user)
        raw = payload.model_dump()
        if raw["native_auto_reply_mode"] not in reply_pipeline.NATIVE_MODES:
            raise HTTPException(status_code=400, detail="不支持的离线自动回复处理方式")
        unknown = [s["key"] for s in raw["stages"] if s["key"] not in reply_pipeline.DEFAULT_STAGE_ORDER]
        if unknown:
            raise HTTPException(status_code=400, detail=f"未知的回复环节: {', '.join(unknown)}")
        config = reply_pipeline.normalize_config(raw)
        if not db_manager.save_reply_pipeline_config(cookie_id, config):
            raise HTTPException(status_code=500, detail="保存失败")
        return {"success": True, "config": config}

    return router
