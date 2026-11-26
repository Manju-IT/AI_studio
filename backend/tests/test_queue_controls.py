
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

class Tests(unittest.TestCase):
    def test_transitions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            config=types.ModuleType('app.core.config')
            config.get_settings=lambda: types.SimpleNamespace(storage_root=root)
            with patch.dict(sys.modules, {'app.core.config':config}):
                from app.services.jobs.local_queue import save, load
                from app.services.jobs.queue_controls import transition
                p=root/'job.json'; source=root/'audio.upload'; source.touch()
                save(p,dict(status='queued',kind='asr',source=str(source)))
                transition(p,{'queued'},'cancelled')
                with self.assertRaises(ValueError): transition(p,{'queued'},'processing')
                transition(p,{'cancelled'},'queued')
                transition(p,{'queued'},'processing')
                with self.assertRaises(ValueError): transition(p,{'queued'},'cancelled')
                self.assertEqual(load(p)['status'],'processing')
                save(p,dict(status='failed',kind='asr',source=str(source)))
                source.unlink()
                with self.assertRaises(ValueError): transition(p,{'failed'},'queued')
if __name__=='__main__': unittest.main()
