#!/usr/bin/env python3
"""Upload a committed release, preserve production data, check health or roll back."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess

p=argparse.ArgumentParser()
p.add_argument('--manifest',type=Path,required=True)
p.add_argument('--host',default='root@47.93.237.1')
p.add_argument('--key',type=Path,default=Path.home()/'.ssh/id_ed25519')
p.add_argument('--model-env',type=Path,required=True)
p.add_argument('--source-records',type=Path,required=True)
a=p.parse_args()
m=json.loads(a.manifest.read_text()); archive=Path(m['archive'])
if not re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{8}',m['release']): raise SystemExit('Invalid release ID')
if hashlib.sha256(archive.read_bytes()).hexdigest()!=m['sha256']: raise SystemExit('Archive hash mismatch')
if not a.model_env.is_file() or not a.source_records.is_file(): raise SystemExit('Configuration or source records not found')
ssh=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-i',str(a.key),a.host]
scp=['scp','-q','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-i',str(a.key)]
def remote(script): subprocess.run(ssh+['sh -s'],input=script,text=True,check=True)
stage='/srv/zhihu-hackathon/incoming/'+m['release']
remote('set -eu\numask 077\nmkdir -p '+shlex.quote(stage)+'\nchmod 700 '+shlex.quote(stage)+'\n')
for src,name in [(archive,'release.tar.gz'),(a.model_env,'deepseek.env'),(a.source_records,'sources.json')]:
    subprocess.run(scp+[str(src),a.host+':'+stage+'/'+name],check=True)
script=r'''set -eu
stage=__STAGE__
release=__RELEASE__
base=/srv/zhihu-hackathon
release_dir="$base/product/releases/$release"
test ! -e "$release_dir"
printf '%s  %s\n' __SHA__ "$stage/release.tar.gz" | sha256sum -c -
mkdir "$release_dir"
tar -xzf "$stage/release.tar.gz" -C "$release_dir"
chmod -R a+rX "$release_dir"
python="$base/product/runtime-venv/bin/python"
test -x "$python"
"$python" -m pip install -q -r "$release_dir/requirements-content.lock"
previous=$(readlink -f "$base/product/current")
backup="$base/shared/backups/$release"
mkdir -p "$backup"
chmod 700 "$backup"
printf '%s\n' "$previous" > "$backup/previous-release"
cp /etc/nginx/conf.d/zhihu.yunzhicompany.com.conf "$backup/nginx.conf"
mkdir -p /etc/systemd/system/zhihu-demo.service.d /etc/zhihu-hackathon
test ! -f /etc/systemd/system/zhihu-demo.service.d/runtime.conf || cp /etc/systemd/system/zhihu-demo.service.d/runtime.conf "$backup/runtime.conf"
test ! -f /etc/zhihu-hackathon/deepseek.env || cp /etc/zhihu-hackathon/deepseek.env "$backup/deepseek.env"
"$python" - "$backup/app.sqlite3" <<'PY'
import sqlite3,sys
src=sqlite3.connect('/srv/zhihu-hackathon/shared/app.sqlite3'); dst=sqlite3.connect(sys.argv[1]); src.backup(dst); dst.close(); src.close()
PY
rollback() {
  ln -sfn "$previous" "$base/product/current.rollback"
  mv -Tf "$base/product/current.rollback" "$base/product/current"
  cp "$backup/nginx.conf" /etc/nginx/conf.d/zhihu.yunzhicompany.com.conf
  if test -f "$backup/runtime.conf"; then cp "$backup/runtime.conf" /etc/systemd/system/zhihu-demo.service.d/runtime.conf; else rm -f /etc/systemd/system/zhihu-demo.service.d/runtime.conf; fi
  if test -f "$backup/deepseek.env"; then cp "$backup/deepseek.env" /etc/zhihu-hackathon/deepseek.env; fi
  systemctl daemon-reload
  nginx -t && systemctl reload nginx
  systemctl restart zhihu-demo.service
  echo 'Release failed. Previous code/config restored; additive database retained.' >&2
}
trap 'rollback' EXIT
install -m 600 -o root -g root "$stage/deepseek.env" /etc/zhihu-hackathon/deepseek.env
rm "$stage/deepseek.env"
cat > /etc/systemd/system/zhihu-demo.service.d/runtime.conf <<'UNIT'
[Service]
ExecStart=
ExecStart=/srv/zhihu-hackathon/product/runtime-venv/bin/python /srv/zhihu-hackathon/product/current/server.py
EnvironmentFile=/etc/zhihu-hackathon/deepseek.env
UNIT
"$python" - <<'PY'
from pathlib import Path
import re
p=Path('/etc/nginx/conf.d/zhihu.yunzhicompany.com.conf')
t=p.read_text(); t=re.sub(r'proxy_read_timeout\s+\d+s;', 'proxy_read_timeout 150s;',t)
if 'location ^~ /submission/' not in t:
    needle='    location / {\n        proxy_pass'
    if needle not in t: raise SystemExit('Unknown nginx shape')
    t=t.replace(needle,'    location ^~ /submission/ {\n        alias /srv/zhihu-hackathon/product/current/public/submission/;\n        index index.html;\n        add_header Cache-Control "no-cache";\n    }\n'+needle)
p.write_text(t)
PY
nginx -t
systemctl stop zhihu-demo.service
cd "$release_dir"
APP_DB="$base/shared/app.sqlite3" "$python" -c 'import server; server.initialize()'
"$python" -m content_pipeline --db "$base/shared/app.sqlite3" import-json "$stage/sources.json"
"$python" -m content_pipeline --db "$base/shared/app.sqlite3" run-once --limit 5
chown zhihu-demo:zhihu-demo "$base/shared/app.sqlite3"*
ln -s "$release_dir" "$base/product/current.next"
mv -Tf "$base/product/current.next" "$base/product/current"
systemctl daemon-reload
systemctl restart zhihu-demo.service
systemctl reload nginx
ok=0
for n in 1 2 3 4 5 6 7 8; do
  if curl -fsS http://127.0.0.1:8096/api/health >/dev/null && curl -fsS http://127.0.0.1:8096/api/ai/status | "$python" -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("configured") and d.get("enabled") else 1)'; then ok=1; break; fi
  sleep 1
done
test "$ok" = 1
trap - EXIT
printf 'DEPLOYED %s\nPREVIOUS %s\nBACKUP %s\n' "$release_dir" "$previous" "$backup"
'''
script=script.replace('__STAGE__',shlex.quote(stage)).replace('__RELEASE__',shlex.quote(m['release'])).replace('__SHA__',shlex.quote(m['sha256']))
remote(script)
