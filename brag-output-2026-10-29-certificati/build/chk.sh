#!/bin/bash
# Riassunto del check: errori e avvisi (senza il rumore dei clip_media_fit già risolti).
cd "$(dirname "$0")/../composition" && timeout 290 npx --yes hyperframes@0.8.185 check --json 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
for k in ('lint','runtime','layout','motion','contrast','craft'):
    x=d.get(k,{}); print(k.upper(), 'err',x.get('errorCount'),'warn',x.get('warningCount'))
    seen={}
    for f in x.get('findings',[]):
        key=(f['severity'],f['code'])
        seen.setdefault(key,[]).append(f)
    for (sev,code),fs in seen.items():
        f=fs[0]; print('  ',sev,code,'x%d'%len(fs),'|',f['message'][:200].replace('\n',' '),'|',f.get('selector','')[:60],'t=',f.get('time'))
"
