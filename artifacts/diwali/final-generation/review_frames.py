"""Make timestamped full-timeline contact sheets for visual review."""
import json, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

path=Path(sys.argv[1]).resolve()
destination=path.parent/(path.stem+'-review')
destination.mkdir(exist_ok=True)
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))
(destination/'probe.json').write_text(json.dumps(probe,indent=2))
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(path),'-vf','fps=4,scale=400:-1',str(destination/'frame-%03d.jpg')],check=True)
frames=sorted(destination.glob('frame-*.jpg'))
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18)
for start in range(0,len(frames),24):
    sheet=Image.new('RGB',(2400,1000),'#10243c')
    draw=ImageDraw.Draw(sheet)
    for local,frame in enumerate(frames[start:start+24]):
        x=(local%6)*400;y=(local//6)*250
        sheet.paste(Image.open(frame),(x,y))
        draw.text((x+8,y+228),f'{(start+local)/4:.2f}s',font=font,fill='white')
    sheet.save(destination/f'contact-{start//24+1}.jpg',quality=92)
print(json.dumps({'duration':probe['format']['duration'],'streams':[{'type':s['codec_type'],'width':s.get('width'),'height':s.get('height'),'fps':s.get('avg_frame_rate'),'codec':s['codec_name']} for s in probe['streams']],'review_frames':len(frames),'review_directory':str(destination)}))
