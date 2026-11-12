"""Preparação pública em cópia descartável, sem alterar o namespace do usuário."""
import pathlib
import subprocess
import tempfile
import shutil
import unittest
import sys
ROOT=pathlib.Path(__file__).resolve().parent.parent
class Preparation(unittest.TestCase):
    def test_packages_and_rejection_without_overwrite(self):
        (ROOT/'.validation').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='prepare-',dir=ROOT/'.validation') as tmp:
            root=pathlib.Path(tmp)
            (root/'scripts').mkdir();(root/'Wokwi').mkdir()
            shutil.copyfile(ROOT/'scripts/prepare-demo.py',root/'scripts/prepare-demo.py')
            for name in ['sketch.ino','diagram.json','libraries.txt']:
                shutil.copyfile(ROOT/'Wokwi'/name,root/'Wokwi'/name)
            def run(*args):
                return subprocess.run([sys.executable,str(root/'scripts/prepare-demo.py'),*args],capture_output=True,text=True)
            self.assertEqual(run('--devices','nightcare-001,nightcare-002').returncode,0)
            first=(root/'Wokwi/demo/nightcare-001/mqtt_demo.h').read_text()
            second=(root/'Wokwi/demo/nightcare-002/mqtt_demo.h').read_text()
            env=(root/'.env.demo').read_text()
            self.assertNotEqual(first,second)
            self.assertIn('#define NIGHTCARE_DEVICE_ID "nightcare-002"',second)
            self.assertEqual(run('--devices','nightcare-003').returncode,0)
            self.assertEqual((root/'Wokwi/demo/nightcare-001/mqtt_demo.h').read_text(),first)
            self.assertEqual((root/'.env.demo').read_text().splitlines()[:3],env.splitlines()[:3])
            for invalid in ['../outside','a,a','a'*33,'nightcare-backend']:
                before=(root/'.env.demo').read_bytes()
                self.assertNotEqual(run('--devices',invalid).returncode,0)
                self.assertEqual((root/'.env.demo').read_bytes(),before)
            (root/'Wokwi/demo/nightcare-002/mqtt_demo.h').write_text(first)
            self.assertNotEqual(run().returncode,0)
            self.assertEqual((root/'Wokwi/demo/nightcare-002/mqtt_demo.h').read_text(),first)
if __name__=='__main__': unittest.main()
