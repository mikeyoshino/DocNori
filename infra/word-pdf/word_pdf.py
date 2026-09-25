"""Executed only inside word-sandbox; no document data or paths printed to logs."""
import os
import pathlib
import shutil
import subprocess
import sys
import time
import zipfile
import xml.etree.ElementTree as ET

run = pathlib.Path(sys.argv[1]).resolve()
os.environ.update(HOME=str(run), TMPDIR=str(run / 'tmp'), SAL_USE_VCLPLUGIN='svp', LANG='C.UTF-8', OSL_SOCKET_PATH='.')
(run / 'tmp').mkdir(exist_ok=True)
source = run / 'source.bin'
with source.open('rb') as stream:
    header = stream.read(8)

# Reject oversized expanded packages, active embedded content and linked resources.
# Hyperlinks are inert and may remain, but linked images/templates/altChunk do not.
if header.startswith(b'PK'):
    with zipfile.ZipFile(source) as z:
        infos = z.infolist()
        names = {i.filename for i in infos}
        if len(infos) > 10000 or sum(i.file_size for i in infos) > 200_000_000 or 'word/document.xml' not in names:
            raise ValueError('Unsupported package')
        for item in infos:
            name = item.filename.lower()
            if item.flag_bits & 1 or any(s in name for s in ('vbaproject', '/embeddings/', '/activex/')):
                raise ValueError('Active content')
            if name.endswith('.rels'):
                if item.file_size > 2_000_000: raise ValueError('Large relationships')
                for rel in ET.fromstring(z.read(item)).iter():
                    if rel.attrib.get('TargetMode', '').lower() == 'external' and not rel.attrib.get('Type', '').endswith('/hyperlink'):
                        raise ValueError('Linked resource')
    extension = 'docx'
elif header == bytes.fromhex('d0cf11e0a1b11ae1'):
    extension = 'doc'
else:
    raise ValueError('Not a Word document')
source = source.rename(run / ('source.' + extension))

import uno
import unohelper
from com.sun.star.beans import PropertyValue
from com.sun.star.task import XInteractionHandler

class AbortInteraction(unohelper.Base, XInteractionHandler):
    def handle(self, request):
        for continuation in request.getContinuations():
            abort = continuation.queryInterface(uno.getTypeByName('com.sun.star.task.XInteractionAbort'))
            if abort:
                abort.select()
                return

def prop(name, value):
    return PropertyValue(name, 0, value, 0)

profile = run / 'profile'
(profile / 'user').mkdir(parents=True)
(profile / 'user' / 'registrymodifications.xcu').write_text('''<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>''')
pipe = 'docnori_' + run.name
command = ['/usr/lib/libreoffice/program/soffice.bin', '-env:UserInstallation=' + profile.as_uri(), '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--norestore', '--accept=pipe,name=' + pipe + ';urp;StarOffice.ComponentContext']
process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
restarts = 0
document = None
try:
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    for attempt in range(100):
        try:
            context = resolver.resolve('uno:pipe,name=' + pipe + ';urp;StarOffice.ComponentContext')
            break
        except Exception:
            if process.poll() is not None:
                if process.returncode == 81 and restarts < 1:
                    restarts += 1
                    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else: raise RuntimeError('Converter unavailable')
            time.sleep(.1)
    else: raise RuntimeError('Converter did not start')
    desktop = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
    document = desktop.loadComponentFromURL(source.as_uri(), '_blank', 0, (
        prop('Hidden', True), prop('ReadOnly', True), prop('MacroExecutionMode', 0),
        prop('UpdateDocMode', 0), prop('InteractionHandler', AbortInteraction()),
    ))
    if document is None or not document.supportsService('com.sun.star.text.TextDocument'):
        raise ValueError('Unsupported or protected document')
    document.storeToURL((run / 'document.pdf').as_uri(), (
        prop('FilterName', 'writer_pdf_Export'), prop('Overwrite', True),
        prop('FilterData', (prop('ExportBookmarks', True), prop('ExportFormFields', False))),
    ))
    document.close(True)
    document = None
    desktop.terminate()
finally:
    if process.poll() is None:
        process.terminate()
    try: process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()

# Keep only the completed PDF until the client leaves; failed runs are removed by queue cleanup.
source.unlink(missing_ok=True)
shutil.rmtree(profile, ignore_errors=True)
shutil.rmtree(run / 'tmp', ignore_errors=True)
