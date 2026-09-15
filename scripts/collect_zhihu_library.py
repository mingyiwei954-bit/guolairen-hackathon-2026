"""Bounded official Zhihu collection into the existing provenance-aware library."""
import argparse,json,subprocess,sys,time
from pathlib import Path
from urllib.parse import quote
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from content_pipeline.processor import ContentProcessor
from content_pipeline.storage import connect_content_db
from content_pipeline.urls import normalize_zhihu_url
BASE='https://api.zhihu.com/km-indep-home/hackathon/v2/'

def import_records(records,db_path,out):
    processor=ContentProcessor(db_path);added=skipped=0
    with connect_content_db(db_path) as db:
        existing={r[0] for r in db.execute('SELECT canonical_url FROM content_sources WHERE canonical_url IS NOT NULL')}
    for record in records:
        url=record.pop('_official_url',None) or record.get('source_url')
        canonical=normalize_zhihu_url(url).canonical_url if record.get('source_url') else url
        if canonical in existing:skipped+=1;continue
        path=out/'import-record.json';path.write_text(json.dumps(record,ensure_ascii=False))
        jobs=processor.import_json(path)
        if not record.get('source_url'):
            with connect_content_db(db_path) as db:
                for job in jobs:db.execute('UPDATE content_sources SET original_url=?,canonical_url=? WHERE id=?',(url,url,job['source_id']))
        added+=sum(j['created'] for j in jobs);existing.add(canonical)
    processor.run(limit=max(1,added))
    with connect_content_db(db_path) as db:
        ready=db.execute("SELECT count(*) FROM content_documents WHERE quality_status='ready'").fetchone()[0]
    return {'added':added,'skipped_existing':skipped,'ready_documents':ready}

def main():
    p=argparse.ArgumentParser();p.add_argument('--db',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--cli',type=Path);p.add_argument('--query',action='append',default=[]);p.add_argument('--stories',type=int,default=20);p.add_argument('--saved-search',type=Path,action='append',default=[]);a=p.parse_args()
    a.out.mkdir(parents=True,exist_ok=True);records=[];report={'requests':[],'failures':[]}
    with httpx.Client(timeout=15,follow_redirects=False) as client:
        for kind in ['knowledge','story']:
            response=client.get(BASE+kind+'/list');response.raise_for_status();items=response.json();(a.out/(kind+'-list.json')).write_text(json.dumps(items,ensure_ascii=False))
            report['requests'].append({'kind':kind,'items':len(items)})
            for item in items[:a.stories if kind=='story' else 10]:
                work=str(item.get('work_id',''));url=BASE+kind+'/list#'+quote(work,safe='');body=item.get('description','');scope='summary';author=None
                if kind=='story':
                    detail_url=BASE+'story/'+quote(work,safe='')
                    try:
                        response=client.get(detail_url);response.raise_for_status();detail=response.json();(a.out/(kind+'-'+work+'.json')).write_text(json.dumps(detail,ensure_ascii=False))
                        if detail.get('content'):body=detail['content'];scope='excerpt';url=detail_url
                        author=detail.get('author_name')
                    except (httpx.HTTPError,ValueError) as e:report['failures'].append({'work_id':work,'reason':type(e).__name__})
                    time.sleep(.3)
                if body:records.append({'external_id':'hackathon-'+kind+':'+work,'title':item.get('title'),'content':body,'author_name':author,'content_scope':scope,'content_kind':'article','content_role':'fiction' if kind=='story' else 'knowledge','work_id':work,'_official_url':url})
    search_files=list(a.saved_search)
    for index,query in enumerate(a.query[:6]):
        if not a.cli:raise ValueError('--cli is required for queries')
        result=subprocess.run([str(a.cli),'search','zhihu','--query',query,'--count','10'],capture_output=True,text=True,timeout=35)
        try:data=json.loads(result.stdout)
        except ValueError:report['failures'].append({'query':query,'reason':'invalid_response'});break
        path=a.out/('search-'+str(index)+'.json');path.write_text(json.dumps(data,ensure_ascii=False))
        if data.get('Code')!=0:report['failures'].append({'query':query,'reason':data.get('Message','api_error')});break
        search_files.append(path);report['requests'].append({'query':query,'count':len(data.get('Data',{}).get('Items',[]))});time.sleep(.5)
    for path in search_files:
        data=json.loads(path.read_text())
        for row in data.get('Data',{}).get('Items',[]):
            if row.get('Url') and row.get('ContentText'):records.append({'source_url':row['Url'],'title':row.get('Title'),'author_name':row.get('AuthorName'),'summary':row['ContentText'],'content_scope':'summary','content_role':'community','content_kind':'answer' if row.get('ContentType')=='Answer' else 'article'})
    (a.out/'records.json').write_text(json.dumps(records,ensure_ascii=False))
    report.update(import_records(records,a.db,a.out));report['collected']=len(records)
    (a.out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
