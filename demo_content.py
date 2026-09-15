"""Authored demonstration content, isolated from the evidence library."""
import hashlib
import json
from pathlib import Path

BATCH_SIZE = 12

def initialize_demo_content(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS demo_content_keys(
        key TEXT PRIMARY KEY,question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS demo_feed_cursors(
        session_id TEXT NOT NULL REFERENCES sessions(id),user_stage TEXT NOT NULL,
        mode TEXT NOT NULL,stage TEXT NOT NULL,offset INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(session_id,user_stage,mode,stage));
    ''')
    if db.execute("SELECT 1 FROM metadata WHERE key='guolairen_mock_v1'").fetchone():
        expand_demo_answers(db)
        return
    payload = json.loads((Path(__file__).parent/'fixtures'/'guolairen_mock.json').read_text())
    for index, item in enumerate(payload['items']):
        qid = db.execute('INSERT INTO questions(title,body,stage,target,sample,created) VALUES(?,?,?,?,1,?)',
                         (item['title'],item['body'],item['stage'],item['targets'][0],1600000000-index)).lastrowid
        db.execute('INSERT INTO demo_content_keys(key,question_id) VALUES(?,?)',(item['key'],qid))
        db.executemany('INSERT INTO question_targets(question_id,stage,position) VALUES(?,?,?)',
                       [(qid,stage,pos) for pos,stage in enumerate(item['targets'])])
        db.executemany('INSERT INTO answers(question_id,body,stage,sample,base_votes,created) VALUES(?,?,?,1,?,?)',
                       [(qid,a['body'],a['stage'],a['votes'],1600000000-index) for a in item['answers']])
    db.execute("INSERT INTO metadata(key,value) VALUES('guolairen_mock_v1','1')")
    expand_demo_answers(db)

def expand_demo_answers(db):
    """Incrementally fill authored sample threads; never fabricate visitor replies."""
    if db.execute("SELECT 1 FROM metadata WHERE key='answer_demo_expansion_v1'").fetchone():
        return
    payload = json.loads((Path(__file__).parent/'fixtures'/'answer_demo_expansion.json').read_text())
    for item in payload['items']:
        if 'key' in item:
            row = db.execute('SELECT q.id,q.target,q.created FROM questions q JOIN demo_content_keys k ON k.question_id=q.id WHERE k.key=? AND q.sample=1',(item['key'],)).fetchone()
        else:
            row = db.execute('SELECT id,target,created FROM questions WHERE title=? AND sample=1 ORDER BY id LIMIT 1',(item['title'],)).fetchone()
        if not row:
            continue
        qid, target, created = row
        count = db.execute('SELECT COUNT(*) FROM answers WHERE question_id=?',(qid,)).fetchone()[0]
        for answer in item['answers']:
            if count >= 3:
                break
            if db.execute('SELECT 1 FROM answers WHERE question_id=? AND body=?',(qid,answer['body'])).fetchone():
                continue
            db.execute('INSERT INTO answers(question_id,body,stage,sample,base_votes,created) VALUES(?,?,?,1,0,?)',(qid,answer['body'],answer.get('stage',target),created))
            count += 1
    db.execute("INSERT INTO metadata(key,value) VALUES('answer_demo_expansion_v1','1')")


def rotate_demo_feed(db, items, sid, user_stage, mode, stage, rotate=False):
    """Pin the hottest eligible conversation; rotate the remaining mock rows."""
    if not items:return [],0
    heat=lambda q:int((q.get('answer') or {}).get('votes',0))
    hottest=max(items,key=lambda q:(heat(q),-q['id']))
    active={row[0] for row in db.execute('SELECT DISTINCT question_id FROM answers WHERE sample=0')}
    real=[q for q in items if (not q['sample'] or q['id'] in active) and q['id']!=hottest['id']]
    examples=[q for q in items if q['sample'] and q['id'] not in active and q['id']!=hottest['id']]
    examples.sort(key=lambda q:(-heat(q),q['id']))
    key=(sid,user_stage,mode,stage)
    db.execute('INSERT OR IGNORE INTO demo_feed_cursors(session_id,user_stage,mode,stage) VALUES(?,?,?,?)',key)
    count=BATCH_SIZE-1
    if rotate:db.execute('UPDATE demo_feed_cursors SET offset=offset+? WHERE session_id=? AND user_stage=? AND mode=? AND stage=?',(count,)+key)
    offset=db.execute('SELECT offset FROM demo_feed_cursors WHERE session_id=? AND user_stage=? AND mode=? AND stage=?',key).fetchone()[0]
    batch=[examples[(offset+i)%len(examples)] for i in range(min(count,len(examples)))]
    return [hottest]+sorted(real+batch,key=lambda q:(-heat(q),q['id'])),len(examples)+int(hottest['sample'] and hottest['id'] not in active)
