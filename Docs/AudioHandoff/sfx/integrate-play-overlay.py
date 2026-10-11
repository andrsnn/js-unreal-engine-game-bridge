import hashlib,json,subprocess,time,sys
from pathlib import Path
paths={'saltblade':'/mnt/c/Users/Aidan Anderson/saltblade','hardburn':'/mnt/c/Users/Aidan Anderson/falling-frontier-clone'}
game=sys.argv[1];root=Path(paths[game]);original=(root/'PLAY.md').read_bytes();crlf='true'if b'\r\n'in original else'false'
out=Path('/mnt/g/sfx/integration')/(game+'-play-'+str(int(time.time()*1000)));out.mkdir(parents=True)
def git(*args):
 result=subprocess.run(['git','-c','core.preloadIndex=true','-c','core.fsmonitor=false','-c','core.trustctime=false','-c','core.checkStat=minimal','-c','core.autocrlf='+crlf,'-C',str(root),*args],capture_output=True,timeout=90)
 if result.returncode:raise RuntimeError((args,result.returncode,result.stderr.decode()[-2000:]))
 return result.stdout
before=git('rev-parse','HEAD').decode().strip();target=git('rev-parse','audio/v1').decode().strip();git('merge-base','--is-ancestor',before,target)
changed=git('diff','--name-only',before,target).decode().splitlines();assert changed==['PLAY.md'],changed
owner_patch=git('diff','--binary','--','PLAY.md');assert not git('diff','--cached','--name-only','--','PLAY.md').strip(),'Owner PLAY staged change'
def foreign_index():return sorted(x for x in git('ls-files','--stage','-z').split(b'\0')if x and not x.endswith(b'\tPLAY.md'))
prior=foreign_index();assert(root/'PLAY.md').read_bytes()==original,'PLAY changed during preflight';(out/'before-PLAY.md').write_bytes(original)
(out/'owner-PLAY.patch').write_bytes(owner_patch)
if owner_patch:
 patch=out/'owner-PLAY.patch';git('apply','--reverse','--whitespace=nowarn',str(patch))
try:
 (out/'merge.txt').write_bytes(git('-c','core.safecrlf=false','merge','--ff-only','audio/v1'))
except Exception:
 if owner_patch:(root/'PLAY.md').write_bytes(original)
 raise
if owner_patch:git('apply','--whitespace=nowarn',str(out/'owner-PLAY.patch'))
assert prior==foreign_index(),'Foreign index entries changed'
receipt=dict(game=game,before=before,after=git('rev-parse','HEAD').decode().strip(),changed=changed,foreignIndexEntriesUnchanged=len(prior),ownerWorkingPLAYpreserved=bool(owner_patch),merged=True,beforePLAYsha256=hashlib.sha256(original).hexdigest(),afterPLAYsha256=hashlib.sha256((root/'PLAY.md').read_bytes()).hexdigest())
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(out=str(out),**receipt)))
