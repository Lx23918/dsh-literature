# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Lx23918 and contributors
import sys, json, base64, math, fitz
sys.stdout.reconfigure(encoding='utf-8')
with fitz.open(sys.argv[1]) as doc:
    number, width = int(sys.argv[2]), max(400, min(1800, int(sys.argv[3])))
    if doc.needs_pass or number < 1 or number > len(doc):
        raise ValueError('PDF 无法打开或页码超出范围')
    page = doc[number - 1]
    scale = min(width / page.rect.width, math.sqrt(5000000 / (page.rect.width * page.rect.height)))
    crop = json.loads(sys.argv[4]) if len(sys.argv) > 4 else None
    clip = None
    if crop is not None:
        if len(crop) != 4 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in crop):
            raise ValueError('Invalid crop')
        x, y, w, h = crop
        if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > 1 or y + h > 1:
            raise ValueError('Crop outside page')
        clip = fitz.Rect(x * page.rect.width, y * page.rect.height, (x + w) * page.rect.width, (y + h) * page.rect.height)
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False, annots=True, clip=clip)
    print(json.dumps({'page': number, 'totalPages': len(doc), 'width': pix.width, 'height': pix.height,
                      'image': base64.b64encode(pix.tobytes('png')).decode('ascii')}))
