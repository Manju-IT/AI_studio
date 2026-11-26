import unittest
from inference.manager.capability_registry import describe_runtime, validate_settings

class CapabilityTests(unittest.TestCase):
    def test_supported(self):
        self.assertTrue(describe_runtime('piper')['available'])
        self.assertEqual(validate_settings('piper', {'length_scale': 1.2}), {'length_scale': 1.2})
        self.assertEqual(validate_settings('qwen_mnn', {'seed': None, 'top_k': 50}), {'top_k': 50})
    def test_rejected(self):
        for runtime, settings in [('piper', {'temperature': .7}), ('kokoro', {'speed': 0}), ('qwen_mnn', {'top_k': 1.5}), ('qwen_mnn', {'seed': True}), ('kokoro', {'speed': float('nan')}), ('indic', {})]:
            with self.subTest(runtime=runtime, settings=settings), self.assertRaises(ValueError):
                validate_settings(runtime, settings)
    def test_copy(self):
        describe_runtime('piper')['parameters'].clear()
        self.assertTrue(describe_runtime('piper')['parameters'])
