import hashlib,json,subprocess,time,sys
from pathlib import Path
paths={'saltblade':'/mnt/c/Users/Aidan Anderson/saltblade','hardburn':'/mnt/c/Users/Aidan Anderson/falling-frontier-clone'}
game='saltblade';root=Path(paths[game]);original=(root/'src/platform/audio.ts').read_bytes();crlf='true'if b'\r\n'in original else'false'
out=Path('/mnt/g/sfx/integration')/(game+'-title-ui-'+str(int(time.time()*1000)));out.mkdir(parents=True)
def git(*args):
 result=subprocess.run(['git','-c','core.preloadIndex=true','-c','core.fsmonitor=false','-c','core.trustctime=false','-c','core.checkStat=minimal','-c','core.autocrlf='+crlf,'-C',str(root),*args],capture_output=True,timeout=90)
 if result.returncode:raise RuntimeError((args,result.returncode,result.stderr.decode()[-2000:]))
 return result.stdout
before=git('rev-parse','HEAD').decode().strip();target=git('rev-parse','audio/v1').decode().strip();git('merge-base','--is-ancestor',before,target)
changed=git('diff','--name-only',before,target).decode().splitlines();assert changed==['src/platform/audio.ts','tests/audio.test.ts'],changed
assert not git('diff','--name-only','--','src/platform/audio.ts','tests/audio.test.ts').strip(),'Owner PLAY working change';assert not git('diff','--cached','--name-only','--','src/platform/audio.ts','tests/audio.test.ts').strip(),'Owner PLAY staged change'
def foreign_index():return sorted(x for x in git('ls-files','--stage','-z').split(b'\0')if x and not (x.endswith(b'\tsrc/platform/audio.ts') or x.endswith(b'\ttests/audio.test.ts')))
prior=foreign_index();assert(root/'src/platform/audio.ts').read_bytes()==original,'PLAY changed during preflight';(out/'before-audio.ts').write_bytes(original)
(out/'merge.txt').write_bytes(git('-c','core.safecrlf=false','merge','--ff-only','audio/v1'));assert prior==foreign_index(),'Foreign index entries changed'
receipt=dict(game=game,before=before,after=git('rev-parse','HEAD').decode().strip(),changed=changed,foreignIndexEntriesUnchanged=len(prior),merged=True,beforePLAYsha256=hashlib.sha256(original).hexdigest(),afterPLAYsha256=hashlib.sha256((root/'src/platform/audio.ts').read_bytes()).hexdigest())
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(out=str(out),**receipt)))
