#!/usr/bin/env python3
"""Draw original typographic submission artwork; Pillow is a build-only tool."""
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont

p=argparse.ArgumentParser(); p.add_argument('--output',type=Path,required=True); a=p.parse_args()
a.output.mkdir(parents=True,exist_ok=True)
FONT='/System/Library/Fonts/STHeiti Light.ttc'
BOLD='/System/Library/Fonts/STHeiti Medium.ttc'
def font(size,bold=False): return ImageFont.truetype(BOLD if bold else FONT,size)
blue='#247AF3'; ink='#1F2937'; grey='#66758A'; pale='#EEF5FF'
im=Image.new('RGB',(512,512),'white'); d=ImageDraw.Draw(im)
d.rounded_rectangle((24,24,488,488),radius=116,fill=blue)
d.text((256,248),'过',font=font(300,True),anchor='mm',fill='white')
im.save(a.output/'icon.png')
im=Image.new('RGB',(1600,900),'#F7F9FC'); d=ImageDraw.Draw(im)
d.rounded_rectangle((82,72,146,136),radius=17,fill=blue)
d.text((114,101),'过',font=font(42,True),anchor='mm',fill='white')
d.text((166,84),'过来人',font=font(38,True),fill=ink)
d.text((1280,91),'灵魂匹配局',font=font(23),fill=grey)
d.text((82,213),'同一个问题',font=font(76,True),fill=ink)
d.text((82,321),'听见另一程',font=font(76,True),fill=blue)
d.text((84,459),'跨阶段视角 · 有来源的资料三问',font=font(28),fill=grey)
d.text((84,507),'再把新问题，交给真实的人。',font=font(28),fill=grey)
for y,label,color in [(630,'轻身份',blue),(682,'有限深入',ink),(734,'双向理解',ink)]:
    d.ellipse((85,y+10,96,y+21),fill=color)
    d.text((112,y),label,font=font(26),fill=color)
d.rounded_rectangle((760,207,1512,765),radius=32,fill='white',outline='#E3E9F2',width=2)
d.text((811,258),'我最近不太快乐，怎么办？',font=font(35,True),fill=ink)
d.line((809,332,1461,332),fill='#E8EDF5',width=2)
d.rounded_rectangle((809,375,965,421),radius=12,fill=pale)
d.text((826,386),'小学阶段',font=font(23),fill=blue)
d.text((1012,380),'吃个雪糕吧。',font=font(37),fill=ink)
d.rounded_rectangle((809,492,965,538),radius=12,fill=pale)
d.text((826,503),'工作阶段',font=font(23),fill=blue)
d.text((1012,488),'先出门走走，',font=font(32),fill=ink)
d.text((1012,542),'不给散步安排目的地。',font=font(32),fill=ink)
d.line((809,624,1461,624),fill='#E8EDF5',width=2)
d.text((811,667),'同题切换，发现不同阶段的关注点',font=font(25),fill=grey)
d.text((811,712),'示例对话 · 非真实用户发言',font=font(19),fill='#8894A4')
d.text((82,831),'知乎黑客松 2026 · 校园新锐季',font=font(22),fill=grey)
im.save(a.output/'cover.png')
print(a.output/'cover.png'); print(a.output/'icon.png')
