import subprocess,json,time
from pathlib import Path
root=Path('/mnt/c/Users/Aidan Anderson/saltblade');out=Path('/mnt/g/sfx/integration')/('saltblade-'+str(int(time.time()*1000)));out.mkdir(parents=True)
def git(*args):
 r=subprocess.run(['git','-c','core.preloadIndex=false','-C',str(root),*args],capture_output=True,text=True,timeout=60)
 if r.returncode:raise RuntimeError((args,r.returncode,r.stderr[-2000:]))
 return r.stdout.strip()
before=git('rev-parse','HEAD');audio=git('rev-parse','audio/v1');git('merge-base','--is-ancestor',before,audio)
changed=git('diff','--name-only',before,audio).splitlines();dirty=git('diff','--name-only').splitlines();staged=git('diff','--cached','--name-only').splitlines()
assert not(set(changed)&(set(dirty)|set(staged))),'Overlap must be preserved first'
(out/'before.json').write_text(json.dumps(dict(before=before,audio=audio,changed=changed,dirty=dirty,staged=staged),indent=2))
result=git('-c','core.safecrlf=false','merge','--ff-only','audio/v1');(out/'merge.txt').write_text(result)
after=git('rev-parse','HEAD');remaining=git('diff','--name-only').splitlines();afterstaged=git('diff','--cached','--name-only').splitlines()
assert set(dirty)<=set(remaining),'Concurrent dirty file disappeared';assert staged==afterstaged,'Concurrent staged list changed'
report=dict(game='saltblade',before=before,after=after,audio=audio,changed=changed,dirty=dirty,remaining=remaining,staged=staged,overlap=[],merged=True)
(out/'receipt.json').write_text(json.dumps(report,indent=2));print(json.dumps(dict(out=str(out),before=before,after=after,preservedDirty=len(remaining),preservedStaged=len(staged),merged=True)))
