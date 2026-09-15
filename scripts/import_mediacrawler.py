"""Import explicitly supplied MediaCrawler Zhihu JSON exports; no crawler dependency."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.collect_zhihu_library import import_records

def convert(rows):
    result=[]
    for row in rows:
        if row.get('content_type') not in ('answer','article') or not row.get('content_url'):continue
        text=row.get('content_text') or row.get('desc')
        if not isinstance(text,str) or not text.strip():continue
        result.append({'source_url':row['content_url'],'title':row.get('title'),
            'author_name':row.get('user_nickname'),'content':text,
            'content_scope':'excerpt' if row.get('content_text') else 'summary',
            'content_kind':row['content_type'],'content_role':'community','import_adapter':'mediacrawler-zhihu-v1'})
    return result

def main():
    p=argparse.ArgumentParser();p.add_argument('--file',type=Path,required=True);p.add_argument('--db',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    if a.file.stat().st_size>3*1024*1024:raise ValueError('Split exports into files smaller than 3 MB')
    rows=json.loads(a.file.read_text());rows=rows if isinstance(rows,list) else [rows];a.out.mkdir(parents=True,exist_ok=True)
    print(json.dumps(import_records(convert(rows),a.db,a.out)))
if __name__=='__main__':main()
