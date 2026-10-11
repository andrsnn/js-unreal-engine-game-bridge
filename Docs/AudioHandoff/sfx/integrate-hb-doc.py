import subprocess,json,time,hashlib
from pathlib import Path
root=Path('/mnt/c/Users/Aidan Anderson/falling-frontier-clone');out=Path('/mnt/g/sfx/integration')/('hardburn-doc-'+str(int(time.time()*1000)));out.mkdir(parents=True)
def git(*args):
 r=subprocess.run(['git','-c','core.preloadIndex=true','-c','core.fsmonitor=false','-c','core.trustctime=false','-c','core.checkStat=minimal','-c','core.autocrlf=true','-C',str(root),*args],capture_output=True,timeout=90)
 if r.returncode:raise RuntimeError((args,r.returncode,r.stderr.decode()[-2000:]))
 return r.stdout
before=git('rev-parse','HEAD').decode().strip();audio=git('rev-parse','audio/v1').decode().strip();git('merge-base','--is-ancestor',before,audio)
changed=git('diff','--name-only',before,audio).decode().splitlines();assert changed==['PLAY.md'],changed
assert not git('diff','--cached','--name-only','--','PLAY.md').strip(),'Owner PLAY staged'
assert not git('diff','--ignore-space-at-eol','--','PLAY.md').strip(),'Owner PLAY content changed'
(root/'PLAY.md').read_bytes();(out/'before-PLAY.md').write_bytes((root/'PLAY.md').read_bytes())
def index_other():return sorted(x for x in git('ls-files','--stage','-z').split(b'\0') if x and not x.endswith(b'\tPLAY.md'))
prior=index_other();result=git('-c','core.safecrlf=false','merge','--ff-only','audio/v1');(out/'merge.txt').write_bytes(result)
assert prior==index_other(),'Foreign index entries changed'
after=git('rev-parse','HEAD').decode().strip();receipt=dict(before=before,after=after,changed=changed,merged=True,foreignIndexEntriesUnchanged=len(prior),ownerWorkingFiles='Git fast-forward only touches the verified one-file PLAY delta',lineEndingsBeforeSha256=hashlib.sha256((out/'before-PLAY.md').read_bytes()).hexdigest())
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(out=str(out),**receipt)))
