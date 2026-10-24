# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Lx23918 and contributors
"""Bounded local PDF metadata extraction; this module performs no network requests."""
import sys,json,re,unicodedata
import fitz
sys.stdout.reconfigure(encoding='utf-8')
def clean(s):
    s=re.sub(r'¨([A-Za-z])',lambda m:m.group(1)+'\u0308',s or '')
    return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',s)).strip()
def plausible(s):
    return 18<len(s)<500 and len(s.split())>=4 and not re.search(r'^(arxiv|abstract|research article|open access|mit open access|supplement|supporting|contents|proceedings|accepted|published|author)',s,re.I) and not re.search(r'\.pdf$|microsoft word|untitled|\btex\b',s,re.I)
with fitz.open(sys.argv[1]) as doc:
    if doc.needs_pass:raise ValueError('PDF 已加密')
    meta=doc.metadata or {};front='\n'.join(doc[i].get_text() for i in range(min(2,len(doc))))
    page=doc[0];blocks=page.get_text('dict')['blocks'];candidates=[]
    for block in blocks:
        if 'lines' not in block:continue
        lines=[];sizes=[]
        for line in block['lines']:
            spans=[s for s in line['spans'] if s['text'].strip()]
            if not spans or line['bbox'][1]>page.rect.height*.57:continue
            lines.append(clean(''.join(s['text'] for s in spans)));sizes.append(max(s['size'] for s in spans))
        text=clean(' '.join(lines))
        if lines and plausible(text):candidates.append((max(sizes),block['bbox'][1],text))
    title=clean(meta.get('title'));origin='pdf-metadata'
    if not plausible(title):
        ranked=sorted(candidates,key=lambda c:(-c[0],c[1]));title=ranked[0][2] if ranked else '';origin='pdf-frontmatter'
    if 'MIT Open Access Articles' in front[:100]:
        lines=[clean(s) for s in front.splitlines() if clean(s)]
        if len(lines)>1 and plausible(lines[1]):title=lines[1];origin='repository-cover'
    front_doi=re.sub(r'(doi\.org/|10\.\d{4,9}/)\s*\n\s*',r'\1',front[:18000].replace('\u00ad',''),flags=re.I)
    dois=list(dict.fromkeys(m.rstrip('.,;:)]}') for m in re.findall(r'10\.\d{4,9}/[^\s<>"\x00]+',front_doi,re.I)))[:5]
    arxiv=list(dict.fromkeys(m.group(1) for m in re.finditer(r'(?:arxiv\s*:\s*|arxiv\.org/(?:abs|pdf)/)(\d{4}\.\d{4,5}|[a-z-]+/\d{7})(?:v\d+)?',front,re.I)))
    author=clean(meta.get('author'))
    if re.search(r'^(anonymous(?: submission| authors?)?|unknown|user|author)$',author,re.I):author=''
    journal='';year=''
    heading=re.search(r'^(Journal of Machine Learning Research)\s+\d+\s+\((\d{4})\)',front,re.M)
    if heading:
        journal,year=heading.groups()
        if not author:
            lines=[clean(s) for s in front.splitlines() if clean(s)];start=next((i for i,s in enumerate(lines) if s==title),-1);names=[]
            for line in lines[start+1:start+9] if start>=0 else []:
                if re.match(r'^(Department|University|Editor|Abstract)',line,re.I):break
                if '@' not in line and not re.search(r'\d',line) and 1<len(line.split())<6 and re.match(r'^[A-ZÀ-ÖØ-Ý][\w .’\x27¨-]+$',line) and not line.isupper():names.append(line)
            author='; '.join(names)
    print(json.dumps({'title':title,'authors':author,'year':year,'journal':journal,'titleOrigin':origin,'dois':dois,'arxivIds':arxiv,'frontText':front[:18000],'pageCount':len(doc),'pdfMetadata':{k:meta.get(k,'') for k in ['title','author','creationDate']}},ensure_ascii=False))
