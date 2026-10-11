from pathlib import Path
import json,subprocess,html
ROOT=Path('C:/Users/Aidan Anderson/space-game')
music=json.loads((ROOT/'reports/context-audio/production-music.json').read_text())
sfx=json.loads((ROOT/'reports/context-audio/production-sfx.json').read_text())
titles={'space':'Longwave Horizon · B bass revision','haven':'Dockside Lights','forest':'Green Signal','dunes':'Glass Caravan','ocean':'Tidal Memory','underwater':'Below the Blue','ice':'Pale Aurora','volcanic':'Ember Circuit','dark':'After the Last Sun','vault':'Buried Transmission','ground-combat':'Redline Contact','space-combat':'Burn Vector'}
for row in music:
 row['title']=titles[row['id']]
 # Explicit MP3 alternatives for mobile players; no changes of speed/pitch.
 row['preview']=row['asset'].replace('.ogg','.mp3')
 subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-i',str(ROOT/'public'/row['asset']),'-c:a','libmp3lame','-b:a','192k',str(ROOT/'public'/row['preview'])],check=True)
for row in sfx:
 row['title']=row['id'].replace('-',' ').replace('enemy','Enemy ').replace('creature','Creature ').replace('boss','Boss ').replace('step','Footstep ').title()
 row['preview']=row['asset'].replace('.ogg','.mp3')
 subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-i',str(ROOT/'public'/row['asset']),'-c:a','libmp3lame','-b:a','128k',str(ROOT/'public'/row['preview'])],check=True)
data=json.dumps({kind:[{k:r[k] for k in ['id','title','asset','preview','duration','prompt'] if k in r} for r in rows] for kind,rows in [('music',music),('sfx',sfx)]}).replace('</','<\\/')
style=(ROOT/'public/auditions/index.html').read_text().split('<style>')[1].split('</style>')[0]
page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unlit Worlds · Sound library</title><style>'''+style+'''
select{display:block;width:100%;padding:14px;margin:10px 0;background:#0c121b;color:#e9e6dc;border:1px solid #77948f;font:inherit;min-height:48px}button{font:inherit;padding:12px;background:#263d45;color:#fff;border:1px solid #77948f;cursor:pointer}select:focus-visible,button:focus-visible{outline:3px solid #d9be82}#prompt{white-space:pre-wrap;overflow-wrap:anywhere}
</style></head><body><main><header><small>UNLIT WORLDS / SOUND LIBRARY</small><h1>Music for the journey.</h1><p>The new location scores and game effects. Start with the revised B track, then explore the rest.</p></header>
<article><label for="music">Location or combat</label><select id="music"></select><h2 id="music-title"></h2><p id="duration"></p><audio id="music-player" controls preload="none"></audio><a id="download">Open MP3</a><details><summary>Composition brief</summary><p id="prompt"></p></details></article>
<article style="--accent:#b99cd9"><h2>Sounds in play</h2><label for="sfx">Weapon, equipment or action</label><select id="sfx"></select><audio id="sfx-player" controls preload="none"></audio><p class="note">Individual effects play at their source level. Distance and equipment affect their volume and tone in the game.</p></article>
<details><summary>Original approved B · compare the bass</summary><audio controls preload="none" src="../audio/auditions/ace-dark-synthwave-r4-b.mp3"></audio><a href="../audio/auditions/ace-dark-synthwave-r4-b.mp3">Open original B</a><p class="note">The revision uses B as its audio source, with smooth bass direction and gentle low-mid EQ. The model can also change other details of the arrangement.</p></details>
<footer><p>Music: ACE-Step XL. Effects: Stable Audio 3 Medium. Existing environmental ambience retained.</p><a href="../">Play Unlit Worlds</a></footer></main><script>
const library='''+data+''';
const byId=id=>document.getElementById(id);
for(const kind of ['music','sfx']){const select=byId(kind);for(const row of library[kind]){const option=document.createElement('option');option.value=row.id;option.textContent=row.title;select.appendChild(option);}const update=()=>{const row=library[kind].find(r=>r.id===select.value),player=byId(kind+'-player');player.pause();player.src='../'+(row.preview||row.asset);player.setAttribute('aria-label',row.title);if(kind==='music'){byId('music-title').textContent=row.title;byId('duration').textContent=Math.floor(row.duration/60)+':'+String(Math.floor(row.duration%60)).padStart(2,'0');byId('download').href=player.src;byId('prompt').textContent=row.prompt;}};select.addEventListener('change',update);update();}
document.querySelectorAll('audio').forEach(player=>player.addEventListener('play',()=>document.querySelectorAll('audio').forEach(other=>{if(other!==player)other.pause()})));
</script></body></html>'''
(ROOT/'public/auditions/index.html').write_text(page,encoding='utf-8')
print('Library prepared',len(music),'scores,',len(sfx),'effects')
