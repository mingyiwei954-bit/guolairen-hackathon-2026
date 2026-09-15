"""Import a saved official knowledge-list response without expanding fetch permissions."""
import argparse,json,sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from content_pipeline.processor import ContentProcessor
from content_pipeline.storage import connect_content_db
ENDPOINT='https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/list'
p=argparse.ArgumentParser();p.add_argument('--file',type=Path,required=True);p.add_argument('--db',type=Path,required=True);args=p.parse_args()
items=json.loads(args.file.read_text());records=[]
for item in items:
 if not isinstance(item,dict) or not item.get('work_id') or not item.get('description'):continue
 records.append({'external_id':'hackathon-knowledge:'+str(item['work_id']),'title':item['title'],
  'summary':item['description'],'content_scope':'summary','content_kind':'article',
  'origin_api':ENDPOINT,'work_id':str(item['work_id'])})
processor=ContentProcessor(args.db)
with tempfile.TemporaryDirectory() as tmp:
 path=Path(tmp)/'records.json';path.write_text(json.dumps(records,ensure_ascii=False))
 jobs=processor.import_json(path)
 # This URL identifies the actual list response, not a guessed public article URL.
 with connect_content_db(args.db) as db:
  for job in jobs:
   db.execute('UPDATE content_sources SET original_url=?,canonical_url=?,raw_origin=? WHERE id=?',
              (ENDPOINT,ENDPOINT,str(args.file.resolve()),job['source_id']))
 processor.run(limit=len(jobs))
 with connect_content_db(args.db) as db:
  print(json.dumps({'imported':len(jobs),'ready':db.execute("SELECT count(*) FROM content_documents WHERE quality_status='ready'").fetchone()[0]}))
