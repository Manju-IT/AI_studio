import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / 'app/services/jobs/worker_lock.py'
spec = importlib.util.spec_from_file_location('worker_lock', MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class WorkerLockTest(unittest.TestCase):
    def test_exclusion_and_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'worker.lock'
            code = '''import runpy,sys
from pathlib import Path
lock=runpy.run_path(sys.argv[1])['worker_lock']
with lock(Path(sys.argv[2])) as acquired:
    sys.exit(0 if acquired else 73)
'''
            args = [sys.executable, '-c', code, str(MODULE), str(path)]
            with mod.worker_lock(path) as acquired:
                self.assertTrue(acquired)
                self.assertEqual(subprocess.run(args).returncode, 73)
            self.assertEqual(subprocess.run(args).returncode, 0)

if __name__ == '__main__':
    unittest.main()
