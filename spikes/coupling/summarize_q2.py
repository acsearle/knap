# Summarize out/q2.jsonl: python3 summarize_q2.py
import json, collections
rows=[json.loads(l) for l in open('out/q2.jsonl')]
by=collections.defaultdict(list)
for d in rows: by[(d['axis'],d['mode'],d['w1'])].append(d)
cap=377
def ok(d): return abs(d['w2expect'])<cap
print('axis mode    w1  | pairs | max|meanRatioErr| | max inst rms err | max |phase| teeth (60 s) | max over run | capped pairs')
for k in sorted(by, key=lambda k:(k[0],k[1],k[2])):
    L=[d for d in by[k] if ok(d)]; C=[f"{d['r1']}:{d['r2']}" for d in by[k] if not ok(d)]
    if not L: continue
    print(f"{k[0]} {k[1]:8s} {k[2]:4d} | {len(L):2d} | {max(abs(d['meanRatioErr']) for d in L):.2e} | {max(d['instRatioRmsErr'] for d in L):.2e} | {max(abs(d['phaseErrTeeth']) for d in L):.2e} | {max(d['maxPhaseErrTeeth'] for d in L):.2e} | {' '.join(C)}")
print('worst pair per (mode,w1) axis Z:')
for k in sorted(by):
    if k[0]!='Z': continue
    L=[d for d in by[k] if ok(d)]
    w=max(L,key=lambda d:d['maxPhaseErrTeeth'])
    wi=max(L,key=lambda d:d['instRatioRmsErr'])
    print(f"  {k[1]:8s} {k[2]:4d}: worst phase {w['r1']}:{w['r2']} {w['maxPhaseErrTeeth']:.2e} teeth; worst inst {wi['r1']}:{wi['r2']} {wi['instRatioRmsErr']:.2e}")
caps=[d for d in rows if not ok(d)]
for d in caps: print('capped', d['axis'],d['mode'],d['r1'],d['r2'],d['w1'],'mean ratio err %.3f'%d['meanRatioErr'])
