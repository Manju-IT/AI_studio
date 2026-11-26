import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf
from app.services.audio.project_mix import render_aligned

class DubbingMixTests(unittest.TestCase):
    def test_alignment_and_overrun(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); a=p/'a.wav'; b=p/'b.wav'; out=p/'out.wav'
            sf.write(a,np.full(200,0.2),1000); sf.write(b,np.full(100,0.4),1000)
            render_aligned([(a,0.1,0.2),(b,0.2,0.5)],out,1000)
            x,r=sf.read(out)
            self.assertEqual(len(x),500)
            self.assertTrue(np.allclose(x[:100],0))
            self.assertTrue(np.allclose(x[100:300],0.2,atol=0.001))
            self.assertTrue(np.allclose(x[300:400],0.4,atol=0.001))
            self.assertTrue(np.allclose(x[400:],0))
    def test_invalid_timing(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d)/'out.wav'
            with self.assertRaises(ValueError): render_aligned([(out,2,1)],out)
            self.assertFalse(out.exists())
