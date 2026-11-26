# Align the PHYSICS_REPORT lines of runs at different k: key = line with numbers replaced by '#'.
# Usage: python3 table.py out/report-k1.txt out/report-k2.txt ...  (prints lines whose numbers differ)
import re, sys
NUM = re.compile(r'-?\d+(?:\.\d+)?(?:e[-+]?\d+)?')
runs = []
for f in sys.argv[1:]:
    d = {}
    for line in open(f):
        line = line.strip()
        key = NUM.sub('#', line)
        d.setdefault(key, []).append(NUM.findall(line))
    runs.append(d)
keys = sorted(set().union(*runs))
for k in keys:
    vals = [r.get(k) for r in runs]
    if all(v == vals[0] for v in vals): continue
    print(k)
    n = max(len(v) for v in vals if v)
    for i in range(n):
        cols = []
        for v in vals:
            cols.append(' '.join(v[i]) if v and i < len(v) else '-')
        print('   ' + ' | '.join(cols))
