"""Run one local worker; restart abnormal exits with bounded backoff."""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    env = os.environ.copy()
    env['PYTHONPATH'] = os.pathsep.join([str(ROOT / 'backend'), str(ROOT), env.get('PYTHONPATH', '')])
    failures = 0
    while failures < 5:
        started = time.monotonic()
        child = subprocess.Popen([sys.executable, '-X', 'faulthandler', '-u', str(ROOT / 'inference/worker.py')], cwd=ROOT, env=env)
        try:
            code = child.wait()
        except KeyboardInterrupt:
            try:
                child.wait(timeout=10)
            except (subprocess.TimeoutExpired, KeyboardInterrupt):
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
            return 0
        if code in (0, 73):
            return code
        failures = 0 if time.monotonic() - started >= 300 else failures
        failures += 1
        print(f'Worker exited: {code} (0x{code & 0xffffffff:08X}); failure {failures}/5', flush=True)
        if failures < 5:
            time.sleep(min(30, 2 ** failures))
    return 1

if __name__ == '__main__':
    sys.exit(main())
