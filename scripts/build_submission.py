#!/usr/bin/env python3
"""Build a dependency-free, printable submission page from project documents."""
from pathlib import Path
import html
import re

ROOT = Path(__file__).resolve().parents[1]


def inline(text):
    text = html.escape(text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: '<a href="{}">{}</a>'.format(
        m[2] if m[2].startswith('https://') else {'VERIFICATION.md': '#verification'}.get(m[2], '#'), m[1]), text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    return re.sub(r'`([^`]+)`', r'<code>\1</code>', text)


def render(text):
    out, in_list = [], False
    for line in text.splitlines():
        if not line.strip():
            if in_list:
                out.append('</ul>'); in_list = False
            continue
        match = re.match(r'^(#{1,3}) (.+)$', line)
        if match:
            level = len(match[1]); out.append(f'<h{level}>{inline(match[2])}</h{level}>')
        elif re.match(r'^(?:- |\d+\. )', line):
            if not in_list:
                out.append('<ul>'); in_list = True
            out.append('<li>'+inline(re.sub(r'^(?:- |\d+\. )', '', line))+'</li>')
        else:
            out.append('<p>'+inline(line)+'</p>')
    if in_list: out.append('</ul>')
    return '\n'.join(out)


def main():
    page = ROOT/'public/submission/index.html'
    page.parent.mkdir(parents=True, exist_ok=True)
    content = render((ROOT/'docs/PRODUCT_PLAN.md').read_text())
    verification = render((ROOT/'docs/VERIFICATION.md').read_text())
    page.write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>过来人 · 产品计划书</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#202631;font:16px/1.9 system-ui,-apple-system,"PingFang SC",sans-serif}main{max-width:900px;margin:36px auto;padding:44px 56px;background:white;border:1px solid #e7eaf0;border-radius:20px}h1{font-size:32px;line-height:1.4;margin:0 0 24px}h2{font-size:23px;margin:38px 0 14px}h3{font-size:18px}p,li{overflow-wrap:anywhere}a{color:#146be5;text-underline-offset:4px}nav{display:flex;gap:20px;flex-wrap:wrap;padding-bottom:30px;font-size:14px}strong{font-weight:650}code{font-size:14px}section{border-top:1px solid #e7eaf0;margin-top:48px;padding-top:32px}video{width:100%;max-height:560px;background:#edf0f5;border-radius:12px}small{color:#6f7a8a}@media(max-width:600px){main{margin:0;padding:28px 22px;border:0;border-radius:0}h1{font-size:26px}}@media print{body{background:white}main{margin:0;max-width:none;border:0;padding:0}nav,.video-section{display:none}h2{break-after:avoid}p,li{orphans:3;widows:3}a{color:inherit}}</style>
<main><nav><a href="/">打开产品体验</a><a href="https://github.com/mingyiwei954-bit/guolairen-hackathon-2026">公开代码仓库</a><a href="#verification">验证状态</a></nav>'''+content+'''
<section class="video-section"><h2>演示视频</h2><p><a href="demo.mp4">观看或下载演示视频</a></p><video controls preload="metadata" src="demo.mp4"></video><small>172 秒字幕导览，使用实际页面操作画面和本轮真实模型记录；不作为连续实时录屏或延迟证明。</small></section>
<section id="verification">'''+verification+'</section></main></html>',encoding='utf-8')
    print(page)


if __name__ == '__main__': main()
