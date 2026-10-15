import sys,os,re,json
from svgpathtools import parse_path
d=sys.argv[1]; out={}
for f in sorted(os.listdir(d)):
    if not f.endswith('.svg'): continue
    ch=chr(int(f[:5],16)); txt=open(os.path.join(d,f),encoding='utf8').read()
    strokes=[]
    for m in re.finditer(r'<path[^>]*?\sd="([^"]+)"',txt):
        p=parse_path(m.group(1)); L=p.length(); n=max(2,int(L/2.5)+1)
        pts=[]
        for i in range(n):
            z=p.point(p.ilength(L*i/(n-1)) if 0<i<n-1 else (0 if i==0 else 1))
            pts+= [round(z.real*10), round(z.imag*10)]
        strokes.append(pts)
    out[ch]=strokes
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,separators=(',',':'))
print(len(out), ''.join(sorted(out)))
missing=[chr(c) for c in list(range(0x3041,0x3097))+list(range(0x30a1,0x30fb))+[0x30fc] if chr(c) not in out]; print('missing',''.join(missing))
