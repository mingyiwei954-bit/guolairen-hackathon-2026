#!/usr/bin/env python3
"""Isolated QA server with real 390/430px iframe viewports; never run in production."""
import argparse
from pathlib import Path
import sys
from urllib.parse import urlsplit,parse_qs

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import server

p=argparse.ArgumentParser()
p.add_argument('--db',type=Path,required=True)
p.add_argument('--port',type=int,default=5175)
a=p.parse_args()
if a.db.resolve()==(ROOT/'data/app.sqlite3').resolve(): raise SystemExit('Use an isolated database')
server.DB_PATH=str(a.db.resolve())
server.initialize()

class QAHandler(server.Handler):
    def do_GET(self):
        u=urlsplit(self.path)
        if u.path=='/__qa_viewport':
            width=390 if parse_qs(u.query).get('w',['390'])[0]=='390' else 430
            body=('''<!doctype html><html><meta charset="utf-8"><title>Isolated viewport QA</title><style>body{margin:0;background:#e9edf3;font:14px system-ui}header{padding:12px 20px}iframe{display:block;border:0;margin:0 auto;background:white}</style><header>QA · '''+str(width)+''' CSS px · isolated database</header><iframe title="Mobile preview" id="app-frame" src="/" width="'''+str(width)+'''" height="844"></iframe></html>''').encode()
            self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        else: super().do_GET()

httpd=server.Server(('127.0.0.1',a.port),QAHandler)
print('Isolated QA: http://127.0.0.1:'+str(a.port),flush=True)
httpd.serve_forever()
