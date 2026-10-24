# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Lx23918 and contributors
import sys, json, fitz
sys.stdout.reconfigure(encoding='utf-8')

def utf16len(s):
    return len(s.encode('utf-16-le')) // 2

def extract(page, number):
    pieces, words, offset, previous = [], [], 0, None
    for item in page.get_text('words', sort=False):
        x0, y0, x1, y1, word, block, line, _ = item
        separator = '' if previous is None else ('\n' if previous != (block, line) else ' ')
        if offset + utf16len(separator + word) > 80000:
            break
        pieces.append(separator)
        offset += utf16len(separator)
        start = offset
        pieces.append(word)
        offset += utf16len(word)
        rect = fitz.Rect(x0, y0, x1, y1) * page.rotation_matrix
        box = [round(max(0, min(1, rect.x0 / page.rect.width)), 6),
               round(max(0, min(1, rect.y0 / page.rect.height)), 6),
               round(max(0, min(1, rect.x1 / page.rect.width)), 6),
               round(max(0, min(1, rect.y1 / page.rect.height)), 6)]
        words.append([start, offset, *box])
        previous = (block, line)
    return {'page': number, 'text': ''.join(pieces), 'width': page.rect.width,
            'height': page.rect.height, 'words': words}

with fitz.open(sys.argv[1]) as doc:
    if doc.needs_pass:
        raise ValueError('PDF 已加密，请先解锁')
    if len(doc) > 5000:
        raise ValueError('PDF 超过 5000 页')
    print(json.dumps({'version': 2, 'pages': [extract(page, i + 1) for i, page in enumerate(doc)]}, ensure_ascii=False))
