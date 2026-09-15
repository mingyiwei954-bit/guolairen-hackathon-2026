"""Validated local answer attachments and backwards-compatible metadata."""
import base64
import binascii
import hashlib
import io
import json
import re
import time
import warnings
from pathlib import Path

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_UPLOAD_BODY = 7 * 1024 * 1024
IMAGE_TYPES = {'image/jpeg': ('JPEG', 'jpg'), 'image/png': ('PNG', 'png'), 'image/webp': ('WEBP', 'webp')}
UPLOAD_PATH = re.compile(r'^/uploads/([a-f0-9]{64})\.(jpg|png|webp)$')


class MediaError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def migrate(db):
    columns = {row[1] for row in db.execute('PRAGMA table_info(answers)')}
    for name in ('tags', 'topics', 'images'):
        if name not in columns:
            db.execute("ALTER TABLE answers ADD COLUMN {} TEXT NOT NULL DEFAULT '[]'".format(name))
    db.execute('''CREATE TABLE IF NOT EXISTS uploads(
        id TEXT NOT NULL, owner TEXT NOT NULL REFERENCES sessions(id), url TEXT NOT NULL,
        mime TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(id,owner))''')


def upload_directory(db_path):
    return Path(db_path).resolve().parent / 'uploads'


def save_upload(db, db_path, owner, data_url):
    from PIL import Image, ImageOps, UnidentifiedImageError
    if not isinstance(data_url, str) or ',' not in data_url:
        raise MediaError('请选择 JPEG、PNG 或 WebP 图片')
    header, encoded = data_url.split(',', 1)
    mime = header[5:-7] if header.startswith('data:') and header.endswith(';base64') else ''
    if mime not in IMAGE_TYPES:
        raise MediaError('只支持 JPEG、PNG 或 WebP 图片')
    if len(encoded) > ((MAX_IMAGE_BYTES + 2) // 3) * 4:
        raise MediaError('每张图片不能超过 5 MB', 413)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise MediaError('图片数据不完整')
    if len(raw) > MAX_IMAGE_BYTES:
        raise MediaError('每张图片不能超过 5 MB', 413)
    expected, extension = IMAGE_TYPES[mime]
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as probe:
                if probe.format != expected or probe.width * probe.height > 20_000_000 or max(probe.size) > 10000:
                    raise MediaError('图片格式或尺寸不支持，请选择小于 2000 万像素的图片')
                probe.verify()
            with Image.open(io.BytesIO(raw)) as original:
                clean = ImageOps.exif_transpose(original)
                clean.load()
                if expected == 'JPEG':
                    clean = clean.convert('RGB')
                elif clean.mode not in ('RGB', 'RGBA'):
                    clean = clean.convert('RGBA')
                # Re-encoding strips active payloads, EXIF/GPS and trailing data.
                sanitized = Image.frombytes(clean.mode, clean.size, clean.tobytes())
                buffer = io.BytesIO()
                sanitized.save(buffer, format=expected, **({'quality': 88} if expected in ('JPEG', 'WEBP') else {}))
                raw = buffer.getvalue()
    except MediaError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise MediaError('图片无法读取，请重新选择')
    if len(raw) > MAX_IMAGE_BYTES:
        raise MediaError('图片处理后超过 5 MB，请缩小图片', 413)
    digest = hashlib.sha256(raw).hexdigest()
    url = '/uploads/{}.{}'.format(digest, extension)
    folder = upload_directory(db_path)
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / '{}.{}'.format(digest, extension)
    if not destination.exists():
        destination.write_bytes(raw)
    db.execute('INSERT OR IGNORE INTO uploads(id,owner,url,mime,created) VALUES(?,?,?,?,?)',
               (digest, owner, url, mime, int(time.time())))
    return {'id': digest, 'url': url, 'mime': mime}


def labels(data, key, maximum, length):
    items = data.get(key, [])
    if not isinstance(items, list) or len(items) > maximum:
        raise MediaError('{}最多 {} 个'.format('标签' if key == 'tags' else '话题', maximum))
    result = []
    for item in items:
        if not isinstance(item, str):
            raise MediaError('标签或话题格式不正确')
        item = item.strip().strip('#').strip()
        if not item or len(item) > length or any(ord(c) < 32 for c in item):
            raise MediaError('标签或话题长度不合适')
        if item not in result:
            result.append(item)
    return result


def metadata(db, owner, data):
    images = data.get('images', [])
    if not isinstance(images, list) or len(images) > 4:
        raise MediaError('最多添加 4 张图片')
    unique_images = []
    for url in images:
        if not isinstance(url, str) or not UPLOAD_PATH.fullmatch(url):
            raise MediaError('请使用已上传的图片')
        if not db.execute('SELECT 1 FROM uploads WHERE owner=? AND url=?', (owner, url)).fetchone():
            raise MediaError('只能使用自己上传的图片', 403)
        if url not in unique_images:
            unique_images.append(url)
    return {'tags': labels(data, 'tags', 5, 20), 'topics': labels(data, 'topics', 3, 40), 'images': unique_images}


def serialize(record):
    for key in ('tags', 'topics', 'images'):
        try:
            value = json.loads(record.get(key) or '[]')
            record[key] = value if isinstance(value, list) else []
        except (ValueError, TypeError):
            record[key] = []
    return record
