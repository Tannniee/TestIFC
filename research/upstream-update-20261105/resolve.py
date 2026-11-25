from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
PATTERN = re.compile(r'(?ms)^<<<<<<<[^\n]*\n(.*?)^\|\|\|\|\|\|\|[^\n]*\n(.*?)^=======\n(.*?)^>>>>>>>[^\n]*\n')

def resolve(path, choices):
    text = (OUT/'conflicts'/path).read_text(encoding='utf-8')
    matches = list(PATTERN.finditer(text))
    if isinstance(choices, str): choices = [choices] * len(matches)
    assert len(choices) == len(matches), (path,len(choices),len(matches))
    iterator=iter(choices)
    def replace(match):
        choice=next(iterator)
        return match[1] if choice=='ours' else match[3] if choice=='theirs' else match[1]+match[3] if choice=='both' else choice
    text=PATTERN.sub(replace,text)
    assert '<<<<<<< custom-r7' not in text, path
    (ROOT/path).write_text(text,encoding='utf-8',newline='\n')
    ledger=OUT/'resolutions.json'
    data=json.loads(ledger.read_text()) if ledger.exists() else {}
    data[path]=choices
    ledger.write_text(json.dumps(data,indent=2))
    return text

def edit(path, old, new):
    file=ROOT/path; text=file.read_text(encoding='utf-8')
    assert text.count(old)==1,(path,old[:60],text.count(old))
    file.write_text(text.replace(old,new),encoding='utf-8',newline='\n')
