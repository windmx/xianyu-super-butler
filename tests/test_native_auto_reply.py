"""闲鱼 App 离线自动回复不能被当成人工接管。

它同样以卖家账号发出，旧逻辑一律暂停会话，于是关键词和 AI 在之后的暂停期内都不再回复。
"""

import asyncio
import unittest
from unittest import mock

from XianyuAutoAsync import XianyuLive, pause_manager
from app import reply_pipeline
from utils.message_utils import (
    SELLER_MESSAGE_BOT_ECHO,
    SELLER_MESSAGE_MANUAL,
    SELLER_MESSAGE_NATIVE_AUTO_REPLY,
    classify_seller_message,
)

CHAT_ID = "chat-native"
BUYER_AT = 1_800_000_000_000


class ClassifySellerMessageTests(unittest.TestCase):
    def test_reply_within_window_is_native(self):
        self.assertEqual(
            classify_seller_message(BUYER_AT + 1500, BUYER_AT, 3),
            SELLER_MESSAGE_NATIVE_AUTO_REPLY,
        )

    def test_reply_after_window_is_manual(self):
        self.assertEqual(classify_seller_message(BUYER_AT + 8000, BUYER_AT, 3), SELLER_MESSAGE_MANUAL)

    def test_unknown_buyer_time_is_manual(self):
        self.assertEqual(classify_seller_message(BUYER_AT, None, 3), SELLER_MESSAGE_MANUAL)

    def test_already_paused_chat_stays_manual(self):
        self.assertEqual(
            classify_seller_message(BUYER_AT + 500, BUYER_AT, 3, already_paused=True),
            SELLER_MESSAGE_MANUAL,
        )

    def test_bot_echo_takes_precedence(self):
        self.assertEqual(
            classify_seller_message(BUYER_AT + 500, BUYER_AT, 3, is_bot_echo=True),
            SELLER_MESSAGE_BOT_ECHO,
        )


class SellerMessageHandlingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        pause_manager.paused_chats.clear()
        self._pause_patch = mock.patch(
            "app.db_manager.db_manager.get_cookie_pause_duration", return_value=10
        )
        self._pause_patch.start()

    def tearDown(self):
        self._pause_patch.stop()
        pause_manager.paused_chats.clear()

    def _live(self):
        live = object.__new__(XianyuLive)
        live.cookie_id = "acc-native"
        live._last_buyer_message_at = {CHAT_ID: BUYER_AT}
        live._bot_sent_messages = {}
        live.message_debounce_lock = asyncio.Lock()
        live.message_debounce_tasks = {}
        return live

    async def _seller_sends(self, live, mode, gap_ms, text="您好，我现在不在，稍后回复"):
        config = reply_pipeline.normalize_config({"native_auto_reply_mode": mode})
        with mock.patch("app.reply_pipeline.load_config", return_value=config):
            await live._handle_seller_sent_message(
                {"1": {"10": {}}}, CHAT_ID, "item", text, BUYER_AT + gap_ms, "t"
            )

    def _paused(self, live):
        return pause_manager.is_chat_paused(CHAT_ID, live.cookie_id)

    async def test_continue_mode_does_not_pause_on_native_reply(self):
        live = self._live()
        await self._seller_sends(live, reply_pipeline.NATIVE_CONTINUE, 800)
        self.assertFalse(self._paused(live))

    async def test_manual_reply_still_pauses(self):
        live = self._live()
        await self._seller_sends(live, reply_pipeline.NATIVE_CONTINUE, 20_000)
        self.assertTrue(self._paused(live))

    async def test_legacy_mode_pauses_even_for_native_reply(self):
        live = self._live()
        await self._seller_sends(live, reply_pipeline.NATIVE_LEGACY, 800)
        self.assertTrue(self._paused(live))

    async def test_yield_mode_cancels_pending_reply_without_pausing(self):
        live = self._live()
        pending = asyncio.ensure_future(asyncio.sleep(60))
        live.message_debounce_tasks[CHAT_ID] = {"task": pending}

        await self._seller_sends(live, reply_pipeline.NATIVE_YIELD, 800)
        await asyncio.sleep(0)

        self.assertTrue(pending.cancelled())
        self.assertNotIn(CHAT_ID, live.message_debounce_tasks)
        self.assertFalse(self._paused(live))

    async def test_own_reply_echo_neither_pauses_nor_counts_twice(self):
        live = self._live()
        live._remember_bot_sent(CHAT_ID, "亲，在的")

        await self._seller_sends(live, reply_pipeline.NATIVE_LEGACY, 20_000, text="亲，在的")
        self.assertFalse(self._paused(live))

        # 同样的内容再出现一次，就是卖家自己手动发的了
        await self._seller_sends(live, reply_pipeline.NATIVE_LEGACY, 20_000, text="亲，在的")
        self.assertTrue(self._paused(live))

    async def test_debounce_waits_for_native_window_only_when_enabled(self):
        live = self._live()
        live.message_debounce_delay = 1
        with mock.patch(
            "app.reply_pipeline.load_config",
            return_value=reply_pipeline.normalize_config({"native_auto_reply_window_seconds": 4}),
        ):
            self.assertEqual(live._reply_debounce_delay(), 4)
        with mock.patch(
            "app.reply_pipeline.load_config",
            return_value=reply_pipeline.normalize_config({"native_auto_reply_mode": "legacy"}),
        ):
            self.assertEqual(live._reply_debounce_delay(), 1)


if __name__ == "__main__":
    unittest.main()
