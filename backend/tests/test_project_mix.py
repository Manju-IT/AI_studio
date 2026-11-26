import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf
from app.services.audio.project_mix import render_project

class ProjectMixTests(unittest.TestCase):
    def test_mixed_rates_and_pause(self):
        with tempfile.TemporaryDirectory() as d:
            a,b,out = [Path(d)/n for n in ('a.wav','b.wav','out.wav')]
            sf.write(a,np.full(1600,0.2),16000)
            sf.write(b,np.full(4800,-0.2),48000)
            render_project([(a,200),(b,900)],out)
            data,rate=sf.read(out)
            self.assertEqual(rate,24000)
            self.assertEqual(len(data),9600)
            self.assertTrue(np.all(data[2400:7200]==0))
            self.assertGreater(data[0],0)
            self.assertLess(data[-1],0)
    def test_empty(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                render_project([],Path(d)/'out.wav')
