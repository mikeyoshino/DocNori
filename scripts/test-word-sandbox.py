"""Real Linux worker isolation/conversion smoke test. Run after docker build.
Usage: python3 scripts/test-word-sandbox.py [image]
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile
import zipfile
import uuid
import atexit

image = sys.argv[1] if len(sys.argv) > 1 else 'docnori-word-test'
fixture = pathlib.Path('tests/fixtures/word-thai.docx')
container = 'docnori-word-check-' + uuid.uuid4().hex[:10]
subprocess.run(['docker','run','-d','--name',container,'--cap-drop=ALL','--security-opt=no-new-privileges:true','--network=none','--memory=1g','--pids-limit=128','--entrypoint=/usr/bin/sleep',image,'300'],check=True,stdout=subprocess.DEVNULL)
atexit.register(lambda: subprocess.run(['docker','rm','-f',container],stdout=subprocess.DEVNULL))
subprocess.run(['docker','exec',container,'mkdir','-p','/app/tmp/word-check'],check=True)
with tempfile.TemporaryDirectory(prefix='docnori-word-check-') as temporary:
    root = pathlib.Path(temporary)
    root.chmod(0o777)
    def sandbox(name, script='/usr/local/lib/docnori/word_pdf.py'):
        target='/app/tmp/word-check/'+name
        subprocess.run(['docker','exec',container,'mkdir','-p',target],check=True)
        for path in (root/name).iterdir():
            if path.is_file():
                path.chmod(0o644)
                subprocess.run(['docker','cp',str(path),container+':'+target+'/'+path.name],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        script=script.replace('/work/','/app/tmp/word-check/')
        result=subprocess.run(['docker','exec',container,'word-sandbox',target,'/usr/bin/python3',script,target],capture_output=True,timeout=60)
        for filename in ['document.pdf','source.doc','protected.docx']:
            subprocess.run(['docker','cp',container+':'+target+'/'+filename,str(root/name/filename)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        return result
    def job(name):
        d = root / name
        d.mkdir(mode=0o777)
        d.chmod(0o777)
        return d
    good = job('good')
    shutil.copyfile(fixture, good/'source.bin')
    result = sandbox('good')
    assert result.returncode == 0, result.stderr.decode()
    assert (good/'document.pdf').read_bytes().startswith(b'%PDF-')
    print('PASS: real Thai DOCX converted in unprivileged sandbox')
    # Run at the same privilege/namespace boundary as a converter exploit.
    other = job('other')
    (other/'secret').write_text('must not be readable')
    (other/'secret').chmod(0o644)
    subprocess.run(['docker','cp',str(other),container+':/app/tmp/word-check/'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    checks = good/'isolation.py'
    checks.write_text('''import pathlib,socket
for path in ['/app/tmp/word-check/other/secret','/proc/1/environ','/app/SabuySign.Host.dll']:
    try: pathlib.Path(path).read_bytes()
    except PermissionError: pass
    else: raise AssertionError('Outside file readable: '+path)
for family in [socket.AF_INET,socket.AF_INET6]:
    try: socket.socket(family,socket.SOCK_STREAM)
    except PermissionError: pass
    else: raise AssertionError('Network socket permitted')
pathlib.Path('/app/tmp/word-check/good/local-write').write_text('ok')
''')
    result = sandbox('good', '/work/good/isolation.py')
    assert result.returncode == 0, result.stderr.decode()
    print('PASS: other jobs, host files, process environment and network inaccessible')
    for name, linked in [('invalid',False),('external',True)]:
        d = job(name)
        if linked:
            with zipfile.ZipFile(fixture) as original, zipfile.ZipFile(d/'source.bin','w') as edited:
                for i in original.infolist():
                    data=original.read(i)
                    if i.filename=='word/_rels/document.xml.rels':
                        data=data.replace(b'</Relationships>',b'<Relationship Id="bad" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://127.0.0.1/private" TargetMode="External"/></Relationships>')
                    edited.writestr(i,data)
        else: (d/'source.bin').write_bytes(b'not a Word document')
        result=sandbox(name)
        assert result.returncode != 0 and not (d/'document.pdf').exists()
        print('PASS: rejected '+name+' document')
    # Produce and round-trip a real legacy Word 97 DOC in a separate isolated profile.
    shutil.copyfile(fixture,good/'source.docx')
    (good/'legacy.py').write_text('''import os,pathlib,subprocess
p=pathlib.Path('/app/tmp/word-check/good')
(p/'tmp').mkdir(exist_ok=True)
os.environ.update(HOME=str(p),TMPDIR=str(p/'tmp'),OSL_SOCKET_PATH='.',SAL_USE_VCLPLUGIN='svp')
command=['/usr/lib/libreoffice/program/soffice.bin','-env:UserInstallation='+ (p/'profile').as_uri(),'--headless','--convert-to','doc:MS Word 97','--outdir',str(p),str(p/'source.docx')]
result=subprocess.run(command)
if result.returncode==81: result=subprocess.run(command)
result.check_returncode()
''')
    result=sandbox('good','/work/good/legacy.py')
    assert result.returncode==0 and (good/'source.doc').exists(), result.stderr.decode()
    legacy=job('legacy')
    shutil.copyfile(good/'source.doc',legacy/'source.bin')
    result=sandbox('legacy')
    assert result.returncode==0 and (legacy/'document.pdf').read_bytes().startswith(b'%PDF-'),result.stderr.decode()
    print('PASS: legacy DOC converted')

    protected_source = job('password-source')
    shutil.copyfile(fixture,protected_source/'source.bin')
    helper = pathlib.Path('infra/word-pdf/word_pdf.py').read_text()
    helper = helper.replace("    document.storeToURL((run / 'document.pdf').as_uri(), (", "    document.storeToURL((run / 'protected.docx').as_uri(), (prop('FilterName', 'Office Open XML Text'), prop('Password', 'test-only-password')))\n    document.storeToURL((run / 'document.pdf').as_uri(), (")
    (protected_source/'protect.py').write_text(helper)
    result=sandbox('password-source','/work/password-source/protect.py')
    assert result.returncode==0, result.stderr.decode()
    protected=job('protected')
    shutil.copyfile(protected_source/'protected.docx',protected/'source.bin')
    result=sandbox('protected')
    assert result.returncode!=0 and not (protected/'document.pdf').exists(),result.stderr.decode()
    print('PASS: password prompt aborted without hanging')
