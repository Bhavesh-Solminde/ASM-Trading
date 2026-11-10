"""Compose exact brand typography and a 17-second local edit; no paid API calls."""
import json, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[2]
FONT=Path('/tmp/asm-diwali-api')
W,H=1920,1080

def text(image, label, size, y, color, bold=False):
    face=ImageFont.truetype(str(FONT/('hanken-700.ttf' if bold else 'hanken-400.ttf')),size)
    draw=ImageDraw.Draw(image)
    draw.text((W/2,y),label,font=face,fill=color,anchor='mt',stroke_width=0)

greeting=Image.new('RGBA',(W,H))
text(greeting,'Happy Diwali',132,320,(244,247,251,255),True)
text(greeting,'May your home be filled with light and joy.',43,489,(177,190,208,255))
greeting.save(BASE/'greeting-overlay.png')
brand=Image.new('RGBA',(W,H))
text(brand,'Warm wishes from',40,295,(206,216,230,255))
logo=Image.open(ROOT/'apps/web/public/brand/indianxtrade-wordmark-compact.png').convert('RGBA')
logo.thumbnail((940,200),Image.Resampling.LANCZOS)
brand.alpha_composite(logo,((W-logo.width)//2,382))
brand.save(BASE/'brand-overlay.png')

# Build a calm animated brand outro locally. The source already contains an
# accurately spelled greeting, so avoid duplicating its generated lettering.
import math, random
import numpy as np
random.seed(2026)
frames=165
base=Image.new('RGB',(W,H))
pixels=np.zeros((H,W,3),dtype=np.uint8)
yy,xx=np.mgrid[0:H,0:W]
glow=np.exp(-(((xx-W/2)/(W*.7))**2+((yy-H/2)/(H*.85))**2))
for k,(edge,mid) in enumerate(zip((8,19,33),(16,36,60))): pixels[:,:,k]=edge+(mid-edge)*glow
base=Image.fromarray(pixels)
particles=[(random.uniform(0,W),random.uniform(-200,H),random.uniform(16,47),random.uniform(1,2.5),random.uniform(0,6.3)) for _ in range(48)]
outro=BASE/'brand-outro.mp4'
encoder=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','warning','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r','30','-i','-','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',str(outro)],stdin=subprocess.PIPE)
for i in range(frames):
    t=i/30
    frame=base.copy()
    draw=ImageDraw.Draw(frame)
    for px,py,speed,r,phase in particles:
        x=px+14*math.sin(t*.55+phase);y=(py+t*speed)%(H+100)-50
        # Keep the centre free for the official wordmark.
        if 420<x<1500 and 230<y<650: continue
        a=(.35+.4*(.5+.5*math.sin(t*1.4+phase)))*min(1,t+.15)
        color=(int(235*a),int(159*a),int(62*a))
        draw.line((x,y,x-2,y-8),fill=color,width=max(1,int(r)))
    layer=brand.copy()
    opacity=min(1,max(0,(t-.2)/.65))
    layer.putalpha(layer.getchannel('A').point(lambda a:int(a*opacity)))
    frame.paste(layer,(0,0),layer)
    encoder.stdin.write(frame.tobytes())
encoder.stdin.close()
if encoder.wait():raise SystemExit('Outro encoder failed')
source=BASE/'kling-source-1080p.mp4'
filters='[0:v]trim=0:12,setpts=PTS-STARTPTS,fps=30,setsar=1[v0];[1:v]fps=30,setsar=1[v1];[v0][v1]xfade=transition=fade:duration=0.5:offset=11.5,format=yuv420p[outv];[0:a]atrim=0:12,asetpts=PTS-STARTPTS,alimiter=limit=0.89:level=false,afade=t=out:st=11:d=1,apad,atrim=0:17[outa]'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','warning','-y','-i',str(source),'-i',str(outro),'-filter_complex',filters,'-map','[outv]','-map','[outa]','-t','17','-r','30','-c:v','libx264','-preset','medium','-crf','18','-c:a','aac','-b:a','192k','-pix_fmt','yuv420p','-movflags','+faststart',str(BASE/'diwali-final-1080p-17s.mp4')],check=True)
(BASE/'edit.json').write_text(json.dumps({'output_duration_seconds':17,'resolution':'1920x1080','fps':30,'native_audio_present':True,'source_duration_used':12,'local_outro_seconds':5.5,'crossfade_seconds':0.5,'method':'Original Kling motion and native sound retained at original speed. Generated greeting lettering retained after visual review; exact official website logo and Hanken Grotesk Warm wishes from text composited in a locally animated blue-and-gold ember outro. Source peak limited, ending audio softly faded. No additional paid generation.'},indent=2))
print('Finished 17-second 1080p composition.')
