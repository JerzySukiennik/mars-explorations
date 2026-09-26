import re, math
D='/home/user/refs/Sansh-M/Hephaestus/src/Data/Atmosphere_Data/Sourced/raw/mars/'  # raw PDS text files (see p-mars-atmo.sources.md)
def parse(fn, skip_extrap=True):
    pts=[]; mode='entry'
    for line in open(D+fn):
        if 'EXTRAPOLATION' in line: mode='extrap'; continue
        if 'PARACHUTE' in line: mode='chute'; continue
        if 'RETRO' in line: mode='retro'; continue
        f=line.split()
        try: nums=[float(x) for x in f]
        except: continue
        if not nums: continue
        if mode=='entry' and len(nums)>=6: z,rho,p,T=nums[2],nums[3],nums[4],nums[5]
        elif mode=='chute' and len(nums)>=5: z,rho,p,T=nums[1],nums[2],nums[3],nums[4]
        elif mode in('extrap','retro') and len(nums)>=4: z,rho,p,T=nums[0:4]
        else: continue
        if mode=='extrap' and skip_extrap: continue
        pts.append((z,rho,p*100.0,T,mode))
    return pts
vl1=parse('VL1_entry_profile.txt')
# UAMS Table III VL1 (upper atmosphere mass spectrometer), 130 & 135 km
vl1.append((130.0,3.80e-9,8.77e-7*100,120.0,'uams'))
vl1.append((135.0,1.59e-9,4.21e-7*100,136.0,'uams'))
vl1.sort(key=lambda r:r[0])
# merge duplicates by z
def interp(pts,z):
    for a,b in zip(pts,pts[1:]):
        if a[0]<=z<=b[0]:
            w=(z-a[0])/(b[0]-a[0]) if b[0]>a[0] else 0
            lr=math.log(a[1])+w*(math.log(b[1])-math.log(a[1]))
            lp=math.log(a[2])+w*(math.log(b[2])-math.log(a[2]))
            T=a[3]+w*(b[3]-a[3])
            return math.exp(lr),math.exp(lp),T
    return None
out=open('/home/user/mars-explorations/refs/data/p-mars-atmo.real.csv','w')
out.write('alt_km,density_kgm3,temperature_K,pressure_Pa\n')
for z in range(0,131):
    r=interp(vl1,float(z))
    out.write(f'{z},{r[0]:.4e},{r[2]:.1f},{r[1]:.4e}\n')
out.close()
vl2=sorted(parse('VL2_entry_profile.txt'),key=lambda r:r[0])
print('z  VL1rho  VL2rho ratio  VL1T VL2T')
for z in range(0,131,5):
    a=interp(vl1,z); b=interp(vl2,z)
    print(z, f'{a[0]:.3e}', f'{b[0]:.3e}' if b else '-', f'{b[0]/a[0]:.2f}' if b else '', f'{a[2]:.0f}', f'{b[2]:.0f}' if b else '')
print('vl2 z range',vl2[0][0],vl2[-1][0])
