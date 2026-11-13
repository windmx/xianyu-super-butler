import os
import tempfile
import unittest
from unittest.mock import Mock, patch

from app import knowledge_base
from app.ai_reply_engine import AIReplyEngine
from app.db_manager import DBManager
from app.routers.ai_knowledge import parse_import_text


def entry(entry_id, title, content, keywords="", item_id="", pinned=False, enabled=True):
    return {
        "id": entry_id, "title": title, "content": content, "keywords": keywords,
        "item_id": item_id, "pinned": pinned, "enabled": enabled,
    }


class RankEntriesTests(unittest.TestCase):
    def test_keyword_hit_ranks_first(self):
        entries = [
            entry(1, "退货政策", "支持七天无理由退货"),
            entry(2, "发货时间", "付款后48小时内发货", keywords="几天发货,什么时候发"),
        ]
        selected = knowledge_base.rank_entries(entries, None, "什么时候发货呀")
        self.assertEqual(selected[0]["id"], 2)
        self.assertTrue(knowledge_base.has_match(selected))

    def test_pinned_always_included_but_not_counted_as_match(self):
        entries = [entry(1, "店铺规则", "不议价，拍下即发", pinned=True)]
        selected = knowledge_base.rank_entries(entries, None, "在吗")
        self.assertEqual([e["reason"] for e in selected], ["pinned"])
        self.assertFalse(knowledge_base.has_match(selected))

    def test_item_scoped_entries_only_apply_to_that_item(self):
        entries = [entry(1, "尺码说明", "这件偏大一码", keywords="尺码", item_id="item-a")]
        self.assertEqual(knowledge_base.rank_entries(entries, "item-b", "尺码怎么选"), [])
        self.assertEqual(len(knowledge_base.rank_entries(entries, "item-a", "尺码怎么选")), 1)

    def test_disabled_and_unrelated_entries_are_skipped(self):
        entries = [
            entry(1, "发货时间", "48小时内发货", keywords="发货", enabled=False),
            entry(2, "电池续航", "满电可用十小时"),
        ]
        self.assertEqual(knowledge_base.rank_entries(entries, None, "什么时候发货"), [])

    def test_greetings_do_not_match_everything(self):
        entries = [entry(1, "你好", "这是一条以你好开头的说明，请问")]
        self.assertEqual(knowledge_base.rank_entries(entries, None, "你好在吗请问"), [])

    def test_total_length_is_bounded(self):
        entries = [
            entry(i, f"发货说明{i}", "发货" + "长" * 900, keywords="发货") for i in range(1, 10)
        ]
        selected = knowledge_base.rank_entries(entries, None, "发货")
        total = sum(len(e["title"]) + len(e["content"]) for e in selected)
        self.assertLessEqual(total, knowledge_base.MAX_TOTAL_CHARS)
        self.assertLessEqual(len(selected), knowledge_base.MAX_MATCHED_ENTRIES)
        self.assertTrue(all(len(e["content"]) <= knowledge_base.MAX_ENTRY_CHARS for e in selected))


class ImportParsingTests(unittest.TestCase):
    def test_parses_common_separators(self):
        entries, invalid = parse_import_text(
            "发货时间 | 48小时内发货\n# 注释\n\n营业时间：每天9:00到21:00\n退货\t七天无理由\n没有分隔符"
        )
        self.assertEqual(
            [(e["title"], e["content"]) for e in entries],
            [("发货时间", "48小时内发货"), ("营业时间", "每天9:00到21:00"), ("退货", "七天无理由")],
        )
        self.assertEqual(invalid, [6])


class KnowledgeStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.manager = DBManager(os.path.join(self.temp_dir.name, "kb.db"))
        admin_id = self.manager.conn.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()[0]
        self.manager.conn.executemany(
            "INSERT INTO cookies (id, value, user_id) VALUES (?, ?, ?)",
            [("acc-a", "c", admin_id), ("acc-b", "c", admin_id)],
        )
        self.manager.conn.commit()

    def tearDown(self):
        self.manager.close()
        self.temp_dir.cleanup()

    def test_crud_is_scoped_to_account(self):
        [entry_id] = self.manager.create_knowledge_entries(
            "acc-a", [{"title": "发货", "content": "48小时", "pinned": True}]
        )
        self.assertEqual(len(self.manager.list_knowledge_entries("acc-a")), 1)
        self.assertEqual(self.manager.list_knowledge_entries("acc-b"), [])

        self.assertFalse(self.manager.update_knowledge_entry(entry_id, "acc-b", {"title": "x"}))
        self.assertTrue(self.manager.update_knowledge_entry(entry_id, "acc-a", {"enabled": False}))
        self.assertEqual(self.manager.list_knowledge_entries("acc-a", enabled_only=True), [])

        self.assertEqual(self.manager.delete_knowledge_entries("acc-b", [entry_id]), 0)
        self.assertEqual(self.manager.delete_knowledge_entries("acc-a", [entry_id]), 1)


class KnowledgeInjectionTests(unittest.TestCase):
    SETTINGS = {
        "ai_enabled": True, "model_name": "m", "api_key": "k", "base_url": "https://example.invalid/v1",
        "max_discount_percent": 10, "max_discount_amount": 100, "max_bargain_rounds": 3,
        "context_enabled": False, "custom_prompts": "",
    }

    def _generate(self, engine, knowledge, **kwargs):
        trace = {}
        with (
            patch.object(engine, "is_ai_enabled", return_value=True),
            patch.object(engine, "save_conversation", return_value="2026-11-13 10:00:00"),
            patch.object(engine, "_get_recent_user_messages", return_value=[]),
            patch.object(engine, "get_bargain_count", return_value=0),
            patch.object(engine, "_is_dashscope_api", return_value=False),
            patch.object(engine, "_is_gemini_api", return_value=False),
            patch.object(engine, "_create_openai_client", return_value=Mock()),
            patch.object(engine, "_call_openai_api", return_value="48小时内发货哦") as call,
            patch("app.ai_reply_engine.db_manager.get_ai_reply_settings", return_value=self.SETTINGS),
            patch("app.knowledge_base.retrieve", return_value=knowledge),
        ):
            reply = engine.generate_reply(
                message="什么时候发货", item_info={"title": "t", "price": 10, "desc": "d"},
                chat_id="c", cookie_id="acc", user_id="u", item_id="i", skip_wait=True,
                trace=trace, **kwargs,
            )
        return reply, call, trace

    def test_matched_knowledge_is_injected_into_system_prompt(self):
        engine = AIReplyEngine()
        knowledge = [{"id": 7, "title": "发货时间", "content": "付款后48小时内发货", "reason": "matched"}]
        reply, call, trace = self._generate(engine, knowledge)

        self.assertEqual(reply, "48小时内发货哦")
        system_prompt = call.call_args.args[2][0]["content"]
        self.assertIn("店铺知识库", system_prompt)
        self.assertIn("付款后48小时内发货", system_prompt)
        self.assertEqual(trace["knowledge"], [{"id": 7, "title": "发货时间", "reason": "matched"}])

    def test_require_hit_skips_model_when_nothing_matched(self):
        engine = AIReplyEngine()
        pinned_only = [{"id": 1, "title": "店规", "content": "不议价", "reason": "pinned"}]
        reply, call, trace = self._generate(engine, pinned_only, require_knowledge_hit=True)

        self.assertIsNone(reply)
        call.assert_not_called()
        self.assertEqual(trace["skipped"], "no_knowledge_hit")

    def test_prompt_override_is_used_for_testing_drafts(self):
        engine = AIReplyEngine()
        _, call, _ = self._generate(engine, [], prompt_override='{"default": "草稿提示词"}')
        self.assertTrue(call.call_args.args[2][0]["content"].startswith("草稿提示词"))


if __name__ == "__main__":
    unittest.main()
