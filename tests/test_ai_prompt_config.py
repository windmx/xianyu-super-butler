import json
import unittest

from app.ai_reply_engine import AIReplyEngine


class PromptConfigTests(unittest.TestCase):
    def setUp(self):
        self.engine = AIReplyEngine()

    def test_legacy_plain_text_becomes_extra_rules(self):
        parsed = self.engine.parse_custom_prompts("不要承诺库存")
        self.assertEqual(parsed["extra_rules"], "不要承诺库存")
        self.assertEqual(parsed["default"], "")

    def test_custom_intent_prompt_replaces_builtin_and_keeps_extra_rules(self):
        raw = json.dumps({"price": "我的议价话术", "extra_rules": "周日不发货"}, ensure_ascii=False)

        price_prompt = self.engine._resolve_system_prompt(raw, "price")
        default_prompt = self.engine._resolve_system_prompt(raw, "default")

        self.assertTrue(price_prompt.startswith("我的议价话术"))
        self.assertIn("周日不发货", price_prompt)
        self.assertNotIn("经验丰富的销售专家", price_prompt)
        # 没有自定义的意图仍用内置提示词，不会被别的意图的自定义内容顶替
        self.assertIn("资深电商卖家", default_prompt)
        self.assertIn("周日不发货", default_prompt)

    def test_empty_custom_prompt_restores_builtin(self):
        raw = json.dumps({"default": "   ", "price": "", "tech": "", "extra_rules": ""})
        self.assertEqual(
            self.engine._resolve_system_prompt(raw, "tech"),
            self.engine.default_prompts["tech"],
        )

    def test_serialize_trims_and_limits_length(self):
        serialized = self.engine.serialize_custom_prompts(
            {"default": "  你好  ", "tech": "长" * 5000, "unknown": "x"}
        )
        parsed = json.loads(serialized)
        self.assertEqual(parsed["default"], "你好")
        self.assertEqual(len(parsed["tech"]), self.engine.PROMPT_MAX_LENGTH)
        self.assertNotIn("unknown", parsed)

    def test_serialize_all_empty_is_empty_string(self):
        self.assertEqual(self.engine.serialize_custom_prompts({"default": " "}), "")

    def test_builtin_prompts_exclude_unused_classify(self):
        self.assertEqual(set(self.engine.get_builtin_prompts()), {"default", "price", "tech"})


if __name__ == "__main__":
    unittest.main()
