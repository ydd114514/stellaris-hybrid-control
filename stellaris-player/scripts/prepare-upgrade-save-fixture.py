"""Prepare an isolated artificial upgrade fixture; never overwrite/load a save.

Only one learned technology is added to player country 0 in the pinned disposable
baseline. This fixture tests native upgrade mechanics, not legitimate research.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse,hashlib,json,re

BASELINE_SHA256='576884af4e1a54d9bb13f429b93a96225a639ee719dd5644921351e57993b99e'
TECH='tech_colonial_centralization'
TOKEN=re.compile(r'#[^\r\n]*|"(?:\\.|[^"\\])*"|[{}=]|[^\s{}=#"]+')

def direct_block(text,key,start=0,end=None):
    depth=0;previous=[];opening=None;found=[]
    for match in TOKEN.finditer(text,start,len(text) if end is None else end):
        token=match.group()
        if token.startswith('#'):continue
        if token=='{':
            if depth==0 and previous[-2:]==[key,'=']:opening=match.end()
            depth+=1
        elif token=='}':
            depth-=1
            if depth<0:raise ValueError('Unbalanced save block')
            if depth==0 and opening is not None:found.append((opening,match.start()));opening=None
        if depth==0:previous=(previous+[token])[-2:]
    if depth or len(found)!=1:raise ValueError(f'Need exactly one direct {key} block')
    return found[0]

def add_technology(text):
    country=direct_block(text,'country');player=direct_block(text,'0',*country);technology=direct_block(text,'tech_status',*player)
    if re.search(r'\btechnology\s*=\s*"'+TECH+r'"',text[technology[0]:technology[1]]):raise ValueError('Fixture technology already present')
    insertion='\n\t\t\ttechnology="'+TECH+'"\n\t\t\tlevel=1\n\t\t'
    body=text[technology[0]:technology[1]]
    # Preserve the native serializer's contiguous technology/level sequence
    # before research queues and alternatives, rather than adding a late pair.
    prefix=re.match(r'(?:\s*technology\s*=\s*"[a-z0-9_]+"\s+level\s*=\s*\d+)+',body)
    if not prefix and body.strip():raise ValueError('Learned technology prefix is not recognized')
    offset=technology[0]+(prefix.end() if prefix else 0)
    patched=text[:offset]+insertion+text[offset:]
    assert patched[:offset]+patched[offset+len(insertion):]==text
    return patched,{'countryId':0,'technology':TECH,'level':1,'insertionOffset':offset,'insertion':insertion}

def prepare(source,destination):
    raw=source.read_bytes();source_hash=hashlib.sha256(raw).hexdigest()
    if source_hash!=BASELINE_SHA256:raise ValueError('Baseline fingerprint mismatch; do not patch an arbitrary save')
    if destination.exists():raise ValueError('Fixture already exists; never overwrite')
    definitions=Path('D:/SteamLibrary/steamapps/common/Stellaris/common/technology')
    matches=[str(p) for p in definitions.glob('*.txt') if re.search(r'^'+TECH+r'\s*=\s*\{',p.read_text(encoding='utf-8-sig'),re.M)]
    if len(matches)!=1:raise ValueError('Technology definition is not uniquely present in installed game')
    with ZipFile(source) as z:
        if sorted(z.namelist())!=['gamestate','meta']:raise ValueError('Unexpected save members')
        content={name:z.read(name) for name in z.namelist()}
    original=content['gamestate'];patched,edit=add_technology(original.decode('utf-8'))
    content['gamestate']=patched.encode('utf-8')
    destination.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(destination,'x',compression=ZIP_DEFLATED) as z:
        for name,data in content.items():z.writestr(name,data)
    with ZipFile(destination) as z:
        assert z.testzip() is None and z.read('meta')==content['meta']
        result=z.read('gamestate').decode('utf-8');a=edit['insertionOffset'];b=a+len(edit['insertion'])
        assert (result[:a]+result[b:]).encode('utf-8')==original
    assert hashlib.sha256(source.read_bytes()).hexdigest()==BASELINE_SHA256
    report={'source':str(source),'sourceSha256':source_hash,'fixture':str(destination),'fixtureSha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'artificialFixture':True,'changes':[edit],'definition':matches[0],'originalUnchanged':True,'resourcesEdited':False,'gameLoaded':False,'runtimeValidated':False}
    destination.with_suffix('.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path);parser.add_argument('destination',type=Path);args=parser.parse_args()
    print(json.dumps(prepare(args.source,args.destination),ensure_ascii=False))
