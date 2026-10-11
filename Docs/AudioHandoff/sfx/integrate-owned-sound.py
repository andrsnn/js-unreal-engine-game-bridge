import subprocess,json,time,sys,hashlib
from pathlib import Path
GAME,TARGET,*ALLOWED=sys.argv[1:]
ROOTS={'saltblade':'/mnt/c/Users/Aidan Anderson/saltblade','hardburn':'/mnt/c/Users/Aidan Anderson/falling-frontier-clone'}
root=Path(ROOTS[GAME]);out=Path('/mnt/g/sfx/integration')/(GAME+'-new-sound-'+str(int(time.time()*1000)));out.mkdir(parents=True)
crlf='true' if b'\r\n' in (root/('src/world/app.ts' if GAME=='saltblade' else 'src/audio.js')).read_bytes() else 'false'
def git(*args):
 p=subprocess.run(['git','-c','core.preloadIndex=true','-c','core.fsmonitor=false','-c','core.trustctime=false','-c','core.checkStat=minimal','-c','core.autocrlf='+crlf,'-C',str(root),*args],capture_output=True,timeout=90)
 if p.returncode:raise RuntimeError(str(args)+' '+p.stderr.decode(errors='replace')[-2500:])
 return p.stdout
before=git('rev-parse','HEAD').decode().strip();target=git('rev-parse',TARGET).decode().strip();branch=git('branch','--show-current').decode().strip();git('merge-base','--is-ancestor',before,target)
changed=git('diff','--name-only',before,target).decode().splitlines();assert changed and set(changed)<=set(ALLOWED),(changed,ALLOWED)
assert not git('diff','--name-only','--',*changed).strip(),'Owner has overlapping unstaged edits; preserve and sync first'
assert not git('diff','--cached','--name-only','--',*changed).strip(),'Owner has overlapping staged edits; preserve and sync first'
owned=set(x.encode() for x in changed)
def foreign_index():return sorted(x for x in git('ls-files','--stage','-z').split(b'\0') if x and x.split(b'\t',1)[1] not in owned)
prior=foreign_index();owned_before={f:(root/f).read_bytes() if (root/f).exists() else None for f in changed}
for f,b in owned_before.items():
 if b is not None:p=out/'before'/f;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
assert git('rev-parse','HEAD').decode().strip()==before,'Primary advanced during preflight'
assert all(((root/f).read_bytes() if (root/f).exists() else None)==b for f,b in owned_before.items()),'Owner wrote overlapping files during preflight'
(out/'merge.txt').write_bytes(git('-c','core.safecrlf=false','-c','merge.autoStash=false','merge','--ff-only',target))
assert prior==foreign_index(),'Foreign index entries changed'
receipt={'game':GAME,'branch':branch,'before':before,'after':git('rev-parse','HEAD').decode().strip(),'changed':changed,'foreignIndexEntriesUnchanged':len(prior),'merged':True,'hashes':{f:hashlib.sha256((root/f).read_bytes()).hexdigest() for f in changed if (root/f).is_file()}}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'out':str(out),**receipt}))
