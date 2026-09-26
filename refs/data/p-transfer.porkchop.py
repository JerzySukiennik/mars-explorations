"""p-transfer reference porkchop (patched-conic, ballistic, no DSM).
Reproduces the minimum-C3 points of the 2026/2028/2031 Earth->Mars opportunities
using JPL DE421 (pip install jplephem skyfield-data pyerfa scipy) and a universal-variable
Lambert solver (Curtis Alg. 5.2). Validated against InSight 2018 (published C3 8.19 km2/s2,
this code 8.20) and MSL 2011 (published 10.78 for 2011-11-25, this code 10.60 for 11-26).
Run: python3 refs/data/p-transfer.porkchop.py
"""
import numpy as np, erfa
from jplephem.spk import SPK
from scipy.optimize import minimize, brentq
MU=1.32712440018e11; DAY=86400.0
def S(z):
    if z>1e-8: s=np.sqrt(z); return (s-np.sin(s))/s**3
    if z<-1e-8: s=np.sqrt(-z); return (np.sinh(s)-s)/s**3
    return 1/6
def C(z):
    if z>1e-8: return (1-np.cos(np.sqrt(z)))/z
    if z<-1e-8: return (np.cosh(np.sqrt(-z))-1)/(-z)
    return 0.5
def lambert(r1,r2,dt,prograde=True):
    R1,R2=np.linalg.norm(r1),np.linalg.norm(r2)
    c=np.cross(r1,r2); th=np.arccos(np.clip(np.dot(r1,r2)/R1/R2,-1,1))
    # prograde about ecliptic north: use ecliptic pole in equatorial coords
    n=np.array([0,-np.sin(np.radians(23.4393)),np.cos(np.radians(23.4393))])
    if np.dot(c,n)<0: th=2*np.pi-th
    A=np.sin(th)*np.sqrt(R1*R2/(1-np.cos(th)))
    def y(z): return R1+R2+A*(z*S(z)-1)/np.sqrt(C(z))
    def F(z):
        yy=y(z)
        if yy<0: return -1e20
        return (yy/C(z))**1.5*S(z)+A*np.sqrt(yy)-np.sqrt(MU)*dt
    zs=np.linspace(-40,4*np.pi**2-1e-3,300)
    fs=[F(z) for z in zs]
    for i in range(len(zs)-1):
        if fs[i]<0<=fs[i+1] and fs[i]>-1e19:
            z=brentq(F,zs[i],zs[i+1]); break
    else: return None
    yy=y(z); f=1-yy/R1; g=A*np.sqrt(yy/MU); gd=1-yy/R2
    v1=(r2-f*r1)/g; v2=(gd*r2-r1)/g
    return v1,v2,th
k=SPK.open('/usr/local/lib/python3.11/dist-packages/skyfield_data/data/de421.bsp')
def pv(seg,jd):
    p,v=seg.compute_and_differentiate(jd); return np.array(p),np.array(v)/DAY
def sun(jd): return pv(k[0,10],jd)
def earth(jd):
    a,av=pv(k[0,3],jd); b,bv=pv(k[3,399],jd); s,sv=sun(jd); return a+b-s, av+bv-sv
def mars(jd):
    a,av=pv(k[0,4],jd); s,sv=sun(jd)
    try: b,bv=pv(k[4,499],jd); a=a+b; av=av+bv
    except KeyError: pass
    return a-s, av-sv
MUM=42828.37; RENT=3396.2+125
def ev(jd,tof,want=None):
    re,ve=earth(jd); rm,vm=mars(jd+tof); s=lambert(re,rm,tof*DAY)
    if s is None: return None
    v1,v2,th=s; typ='I' if th<np.pi else 'II'
    if want and typ!=want: return None
    c3=np.linalg.norm(v1-ve)**2; vi=np.linalg.norm(v2-vm)
    return c3,vi,typ
def jd(y,m,d): a=erfa.cal2jd(y,m,d); return a[0]+a[1]
def cal(j): c=erfa.jd2cal(j,0); return '%d-%02d-%02d'%c[:3]
def report(name,j,t,typ=None):
    c3,vi,ty=ev(j,t,typ); ve=np.sqrt(vi**2+2*MUM/RENT)
    rp=6378.137+300; dv=np.sqrt(c3+2*398600.4418/rp)-np.sqrt(398600.4418/rp)
    print(f"{name} {ty} dep={cal(j)} arr={cal(j+t)} TOF={t:.1f} C3={c3:.3f} vinf_arr={vi:.3f} entry={ve:.3f} dv300={dv:.3f}",flush=True)
report('MSL',jd(2011,11,26),jd(2012,8,6)-jd(2011,11,26))
report('InSight',jd(2018,5,5),jd(2018,11,26)-jd(2018,5,5))
report('M2020',jd(2020,7,30),jd(2021,2,18)-jd(2020,7,30))
report('MAVEN',jd(2013,11,18),jd(2014,9,22)-jd(2013,11,18))
starts={'2026':[(2026,11,11,274,'I'),(2026,10,31,292,'II')],'2028':[(2028,12,10,222,'I'),(2028,11,29,315,'II')],'2031':[(2031,1,27,190,'I'),(2031,2,22,320,'II')]}
for yr,L in starts.items():
    for (y,m,d,t,typ) in L:
        j0=jd(y,m,d)
        def f(x):
            r=ev(j0+x[0],x[1],typ); return 1e3 if r is None else r[0]
        # coarse grid then NM
        best=None
        for dd in np.arange(-30,31,2):
            for dt in np.arange(-60,61,4):
                v=f([dd,t+dt])
                if best is None or v<best[0]: best=(v,dd,t+dt)
        r=minimize(f,[best[1],best[2]],method='Nelder-Mead',options={'xatol':0.01,'fatol':1e-5})
        report(yr,j0+r.x[0],r.x[1],typ)
