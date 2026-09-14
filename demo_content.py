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

def rotate_demo_feed(db, items, sid, user_stage, mode, stage, rotate=False):
    """Only synthetic conversations rotate; real questions/responses stay available."""
    active = {row[0] for row in db.execute('SELECT DISTINCT question_id FROM answers WHERE sample=0')}
    pack = {row[0] for row in db.execute('SELECT question_id FROM demo_content_keys')}
    real = [q for q in items if not q['sample'] or q['id'] in active]
    examples = [q for q in items if q['sample'] and q['id'] not in active]
    seed = '|'.join((sid,user_stage,mode,stage))
    # Keep the original demo scenarios in the initial batch, then mix the new pack.
    examples.sort(key=lambda q:(q['id'] in pack,hashlib.sha256((seed+':'+str(q['id'])).encode()).hexdigest()))
    key = (sid,user_stage,mode,stage)
    db.execute('INSERT OR IGNORE INTO demo_feed_cursors(session_id,user_stage,mode,stage) VALUES(?,?,?,?)',key)
    if rotate:
        step = BATCH_SIZE if len(examples)>BATCH_SIZE else 1
        db.execute('UPDATE demo_feed_cursors SET offset=offset+? WHERE session_id=? AND user_stage=? AND mode=? AND stage=?',(step,)+key)
    offset = db.execute('SELECT offset FROM demo_feed_cursors WHERE session_id=? AND user_stage=? AND mode=? AND stage=?',key).fetchone()[0]
    size = min(BATCH_SIZE,len(examples))
    batch = [examples[(offset+i)%len(examples)] for i in range(size)]
    return real+batch, len(examples)
