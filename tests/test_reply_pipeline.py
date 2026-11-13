import unittest
from unittest import mock

from XianyuAutoAsync import XianyuLive
from app import reply_pipeline

CHAT_ID = "chat-1"
BUYER_ID = "buyer-1"


def _config(order, **overrides):
    config = reply_pipeline.default_config()
    config["stages"] = [
        {"key": key, "enabled": True, **({"require_knowledge_hit": False} if key == "ai" else {})}
        for key in order
    ]
    config.update(overrides)
    return reply_pipeline.normalize_config(config)


class NormalizeConfigTests(unittest.TestCase):
    def test_default_order_matches_previous_hardcoded_chain(self):
        keys = [s["key"] for s in reply_pipeline.enabled_stages(reply_pipeline.default_config())]
        self.assertEqual(keys, ["keyword", "ai", "item_reply", "default"])

    def test_unknown_and_duplicate_stages_dropped_missing_appended_disabled(self):
        config = reply_pipeline.normalize_config({
            "stages": [{"key": "ai"}, {"key": "bogus"}, {"key": "ai", "enabled": False}],
        })
        self.assertEqual([s["key"] for s in config["stages"]], ["ai", "keyword", "item_reply", "default"])
        self.assertEqual([s["key"] for s in reply_pipeline.enabled_stages(config)], ["ai"])

    def test_window_is_clamped_and_mode_validated(self):
        config = reply_pipeline.normalize_config({
            "native_auto_reply_window_seconds": 999, "native_auto_reply_mode": "nope",
        })
        self.assertEqual(config["native_auto_reply_window_seconds"], reply_pipeline.MAX_NATIVE_WINDOW_SECONDS)
        self.assertEqual(config["native_auto_reply_mode"], reply_pipeline.NATIVE_CONTINUE)


class PipelineExecutionTests(unittest.IsolatedAsyncioTestCase):
    def _live(self):
        live = object.__new__(XianyuLive)
        live.cookie_id = "acc"
        live._safe_str = str
        live._add_reply_decision_log = mock.Mock(return_value=1)
        live._update_reply_decision_log = mock.Mock()
        live._find_reply_keyword = mock.Mock(return_value="kw")
        live.get_keyword_reply = mock.AsyncMock(return_value=None)
        live.get_ai_reply = mock.AsyncMock(return_value=None)
        live.get_item_specific_reply = mock.AsyncMock(return_value=None)
        live.get_default_reply = mock.AsyncMock(return_value=None)
        live.send_msg = mock.AsyncMock()
        return live

    async def _run(self, live, config):
        with (
            mock.patch("app.reply_pipeline.load_config", return_value=config),
            mock.patch("app.db_manager.db_manager.matches_message_filter", return_value=None),
        ):
            await live._process_chat_message_reply(
                {"1": {"10": {}}}, None, "买家", BUYER_ID, "多少钱", "item-1", CHAT_ID, "t",
            )

    async def test_first_stage_with_reply_wins(self):
        live = self._live()
        live.get_keyword_reply.return_value = "关键词回复"
        live.get_ai_reply.return_value = "AI回复"

        await self._run(live, reply_pipeline.default_config())

        live.send_msg.assert_awaited_once_with(None, CHAT_ID, BUYER_ID, "关键词回复")
        live.get_ai_reply.assert_not_awaited()

    async def test_custom_order_puts_ai_first(self):
        live = self._live()
        live.get_keyword_reply.return_value = "关键词回复"
        live.get_ai_reply.return_value = "AI回复"

        await self._run(live, _config(["ai", "keyword"]))

        live.send_msg.assert_awaited_once_with(None, CHAT_ID, BUYER_ID, "AI回复")
        live.get_keyword_reply.assert_not_awaited()

    async def test_falls_through_to_item_reply_then_default(self):
        live = self._live()
        live.get_item_specific_reply.return_value = "商品专属"

        await self._run(live, reply_pipeline.default_config())

        live.send_msg.assert_awaited_once_with(None, CHAT_ID, BUYER_ID, "商品专属")
        live.get_default_reply.assert_not_awaited()

    async def test_default_stage_no_longer_repeats_item_reply(self):
        live = self._live()
        live.get_default_reply.return_value = {"text": "默认", "image_url": None}

        await self._run(live, reply_pipeline.default_config())

        self.assertFalse(live.get_default_reply.await_args.kwargs["include_item_reply"])
        live.send_msg.assert_awaited_once_with(None, CHAT_ID, BUYER_ID, "默认")

    async def test_empty_keyword_reply_stops_pipeline(self):
        live = self._live()
        live.get_keyword_reply.return_value = "EMPTY_REPLY"
        live.get_ai_reply.return_value = "AI回复"

        await self._run(live, reply_pipeline.default_config())

        live.send_msg.assert_not_awaited()
        live.get_ai_reply.assert_not_awaited()

    async def test_disabled_stage_is_skipped(self):
        live = self._live()
        live.get_keyword_reply.return_value = "关键词回复"
        config = reply_pipeline.default_config()
        config["stages"][0]["enabled"] = False

        await self._run(live, config)

        live.get_keyword_reply.assert_not_awaited()
        live.send_msg.assert_not_awaited()

    async def test_ai_stage_passes_require_knowledge_hit(self):
        live = self._live()
        config = reply_pipeline.default_config()
        config["stages"][1]["require_knowledge_hit"] = True

        await self._run(live, config)

        self.assertTrue(live.get_ai_reply.await_args.kwargs["require_knowledge_hit"])


if __name__ == "__main__":
    unittest.main()
