#!/usr/bin/env python3
"""Explicit live-model smoke check against a caller-selected test server."""
import argparse
import json
from pathlib import Path
import time
import uuid
import httpx

p=argparse.ArgumentParser()
p.add_argument('--base-url',required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--real-model',action='store_true',help='Authorize three actual model questions')
a=p.parse_args()
if not a.real_model: raise SystemExit('Pass --real-model to acknowledge paid API calls.')
client=httpx.Client(base_url=a.base_url.rstrip('/'),timeout=150,follow_redirects=False)
report={'base_url':a.base_url,'started_at':time.time(),'checks':[],'turns':[]}
def check(name,condition,detail=None):
    report['checks'].append({'name':name,'passed':bool(condition),'detail':detail})
    print(name, 'PASS' if condition else 'FAIL',flush=True)
    if not condition: raise AssertionError(name)
def save():
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
try:
    check('health',client.get('/api/health').json().get('ok'))
    client.get('/api/me').raise_for_status()
    first=client.get('/api/questions/2/ai'); first.raise_for_status()
    check('fresh visitor three turns',first.json()['turns_remaining']==3)
    prompts=[
        '在陌生城市工作，怎样交到志同道合的朋友？',
        '根据这些资料，和同事发展友谊有哪些需要注意的边界？',
        '如果不想只认识同事，资料里还提到了哪些认识朋友的途径？',
    ]
    for i,prompt in enumerate(prompts):
        key=str(uuid.uuid4()); start=time.monotonic()
        r=client.post('/api/questions/2/ai',json={'question':prompt,'client_turn_id':key})
        r.raise_for_status(); snapshot=r.json()
        turn=next(t for t in snapshot['turns'] if t['client_turn_id']==key)
        report['turns'].append({'question':prompt,'elapsed_seconds':round(time.monotonic()-start,3),'snapshot':snapshot})
        check('real answer '+str(i+1),turn['status']=='answered',turn.get('error_code'))
        check('remaining '+str(i+1),snapshot['turns_remaining']==2-i)
        check('valid linked summary evidence '+str(i+1),bool(turn['citations']) and all(c['quote'] and c['source_url'].startswith('https://') and c['content_scope']=='summary' for c in turn['citations']))
        for cite in turn['citations']:
            source=client.get('/api/library/items/'+str(cite['document_id'])); source.raise_for_status()
            data=source.json()
            # Detail endpoint keeps cleaned source text separate from AI output.
            text=json.dumps(data,ensure_ascii=False)
            check('evidence document present '+str(i+1),cite['quote'] in text or cite['quote'] in data.get('body_text',''))
        duplicate=client.post('/api/questions/2/ai',json={'question':prompt,'client_turn_id':key})
        duplicate.raise_for_status()
        check('same request id no extra turn '+str(i+1),duplicate.json()['turns_used']==i+1)
        reopened=client.get('/api/questions/2/ai'); reopened.raise_for_status()
        check('reload state '+str(i+1),reopened.json()['turns_used']==i+1)
        save()
    fourth=client.post('/api/questions/2/ai',json={'question':'再问一次','client_turn_id':str(uuid.uuid4())})
    check('fourth blocked',fourth.status_code==409 and fourth.json()['status']=='limit_reached')
    check('closed input',not fourth.json()['can_ask'])
    check('ordinary feed still usable',client.get('/api/feed?mode=older&stage=all').status_code==200)
    report['passed']=True
finally:
    report['completed_at']=time.time(); save(); client.close()
