#!/usr/bin/env python3
"""Build a captioned walkthrough from actual Browser screenshots, never synthetic UI."""
import argparse,json,subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import imageio_ffmpeg
p=argparse.ArgumentParser();p.add_argument('--scenes',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
scenes=sorted(json.loads(a.scenes.read_text()),key=lambda s:s['file']); out=a.output.parent/'video-build';out.mkdir(exist_ok=True,parents=True)
fontpath='/System/Library/Fonts/STHeiti Light.ttc';boldpath='/System/Library/Fonts/STHeiti Medium.ttc'
def font(n,bold=False): return ImageFont.truetype(boldpath if bold else fontpath,n)
ink='#202A3A'; blue='#247AF3';muted='#64748B'
concat=[]
for i,s in enumerate(scenes):
 im=Image.new('RGB',(1600,900),'#F4F7FB');d=ImageDraw.Draw(im)
 d.rounded_rectangle((66,56,124,114),radius=16,fill=blue);d.text((95,83),'过',font=font(36,True),anchor='mm',fill='white')
 d.text((145,66),'过来人',font=font(30,True),fill=ink);d.text((67,171),f'{i+1:02d} / {len(scenes):02d}',font=font(22),fill=blue)
 title=s['title']; y=226
 # Wrap Chinese headings at 17 glyphs.
 for start in range(0,len(title),17): d.text((66,y),title[start:start+17],font=font(43,True),fill=ink);y+=65
 y+=35
 for line in s['lines']:
  for start in range(0,len(line),27): d.text((69,y),line[start:start+27],font=font(28),fill=muted); y+=47
  y+=10
 d.line((67,728,940,728),fill='#DCE4EE',width=2)
 d.text((69,756),'网页实际操作画面 · 字幕导览',font=font(21),fill=muted)
 d.text((69,792),'AI 记录来自本轮真实 DeepSeek 联调，非即时耗时演示。',font=font(20),fill=muted)
 d.text((69,846),'知乎黑客松 2026 · 灵魂匹配局',font=font(20),fill=muted)
 shot=Image.open(a.scenes.parent/s['file']).convert('RGB')
 if s.get('crop'):
  c=s['crop'];shot=shot.crop((c['x'],c['y'],c['x']+c['width'],c['y']+c['height']))
 shot.thumbnail((420,810),Image.Resampling.LANCZOS)
 im.paste(shot,(1128+(420-shot.width)//2,45+(810-shot.height)//2))
 frame=out/f'scene-{i:02d}.png';im.save(frame)
 concat+=['file '+str(frame),'duration '+str(s['seconds'])]
concat+=['file '+str(frame)]
manifest=out/'frames.txt';manifest.write_text('\n'.join(concat)+'\n')
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run([ffmpeg,'-y','-v','warning','-f','concat','-safe','0','-i',str(manifest),'-r','24','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',str(a.output)],check=True)
print(json.dumps({'video':str(a.output),'duration_seconds':sum(s['seconds'] for s in scenes),'scenes':len(scenes),'bytes':a.output.stat().st_size},ensure_ascii=False))
