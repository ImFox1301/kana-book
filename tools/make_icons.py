import sys
from PIL import Image, ImageDraw, ImageFont
font_path, out = sys.argv[1], sys.argv[2]
IND=(47,79,134); PAPER=(245,246,242); GUIDE=(255,255,255,70)
def icon(size, maskable=False, rounded=True, scale=4):
    S=size*scale
    im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    r=0 if (maskable or not rounded) else int(S*0.22)
    d.rounded_rectangle([0,0,S-1,S-1],radius=r,fill=IND)
    safe = 0.62 if maskable else 0.80   # доля стороны под «лист» с сеткой
    m=(1-safe)/2*S; box=[m,m,S-m,S-m]
    g=Image.new('RGBA',(S,S),(0,0,0,0)); gd=ImageDraw.Draw(g)
    w=max(2,S//160)
    gd.rectangle(box,outline=GUIDE,width=w)
    c=S/2; dash=S/40
    y=box[1]
    while y<box[3]:
        gd.line([c,y,c,min(y+dash,box[3])],fill=GUIDE,width=w); y+=dash*2
    x=box[0]
    while x<box[2]:
        gd.line([x,c,min(x+dash,box[2]),c],fill=GUIDE,width=w); x+=dash*2
    im=Image.alpha_composite(im,g); d=ImageDraw.Draw(im)
    f=ImageFont.truetype(font_path,int(S*safe*0.86))
    d.text((c,c+S*0.01),'か',font=f,fill=PAPER,anchor='mm')
    return im.resize((size,size),Image.LANCZOS)
icon(192).save(f'{out}/icon-192.png')
icon(512).save(f'{out}/icon-512.png')
icon(512,maskable=True).save(f'{out}/icon-maskable-512.png')
icon(180,rounded=False).save(f'{out}/apple-touch-icon.png')
icon(48).save(f'{out}/favicon-48.png')
