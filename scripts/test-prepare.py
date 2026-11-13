"""Preparação pública em cópia descartável, sem alterar o namespace do usuário."""
import pathlib
import subprocess
import tempfile
import shutil
import unittest
import sys
import os
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
            # A new session must refuse incompatible packages before changing env.
            before=(root/'.env.demo').read_bytes()
            self.assertNotEqual(run('--new-session').returncode,0)
            self.assertEqual((root/'.env.demo').read_bytes(),before)
            (root/'Wokwi/demo/nightcare-002/mqtt_demo.h').write_text(second)
            old_env=(root/'.env.demo').read_text()
            self.assertEqual(run('--new-session','--devices','nightcare-001').returncode,0)
            fresh=(root/'.env.demo').read_text()
            self.assertNotEqual(fresh.splitlines()[1],old_env.splitlines()[1])
            self.assertIn('DEMO_DEVICES=nightcare-001\n',fresh)
            self.assertNotIn('DEMO_DATA_VOLUME=nightcare-demo_demo_sqlite',fresh)
            self.assertFalse((root/'Wokwi/demo/nightcare-002').exists())
            archives=list((root/'.validation/demo-sessions').iterdir())
            self.assertEqual(len(archives),1)
            self.assertEqual((archives[0]/'.env.demo').read_text(),old_env)
            self.assertEqual((archives[0]/'Wokwi-demo/nightcare-002/mqtt_demo.h').read_text(),second)
            self.assertEqual(run().returncode,0)
            self.assertEqual((root/'.env.demo').read_text(),fresh)
            # Re-adding a package uses the current session, without stale files.
            self.assertEqual(run('--devices','nightcare-002').returncode,0)
            self.assertIn(fresh.splitlines()[1].split('=',1)[1],(root/'Wokwi/demo/nightcare-002/mqtt_demo.h').read_text())
            # Exercise the public shell command without starting Docker services.
            shutil.copyfile(ROOT/'scripts/demo.sh',root/'scripts/demo.sh')
            (root/'bin').mkdir()
            docker=root/'bin/docker'
            docker.write_text('#!/usr/bin/env bash\nexit 0\n')
            docker.chmod(0o755)
            shell_env={**os.environ,'PATH':str(root/'bin')+os.pathsep+os.environ['PATH']}
            def start(*args):
                result=subprocess.run(['bash',str(root/'scripts/demo.sh'),*args],env=shell_env,capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                return (root/'.env.demo').read_text()
            active=(root/'.env.demo').read_text()
            self.assertEqual(start('--prepare-only'),active)
            self.assertEqual(start('--resume'),active)
            restarted=start('--devices','nightcare-001')
            self.assertNotEqual(restarted,active)
            self.assertIn('DEMO_DEVICES=nightcare-001\n',restarted)
            self.assertEqual(start('--resume','--dev'),restarted)
            self.assertNotEqual(start('--devices','nightcare-001'),restarted)
if __name__=='__main__': unittest.main()
