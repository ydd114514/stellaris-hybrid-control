import {open,stat} from 'node:fs/promises';
import {StringDecoder} from 'node:string_decoder';

export class JsonlTail {
  constructor({readInitial=false}={}){this.readInitial=readInitial;this.path=null;this.offset=0;this.pending='';this.decoder=new StringDecoder('utf8');}
  async read(path,consume){
    if(!path)return;
    const info=await stat(path);
    if(path!==this.path||info.size<this.offset){
      this.path=path;this.offset=this.readInitial?Math.max(0,info.size-1024*1024):info.size;
      this.pending='';this.decoder=new StringDecoder('utf8');this.skipPartial=this.readInitial&&this.offset>0;
    }
    if(info.size===this.offset)return;
    const file=await open(path),size=Math.min(info.size-this.offset,1024*1024),buffer=Buffer.alloc(size);
    try{const r=await file.read(buffer,0,size,this.offset);this.offset+=r.bytesRead;this.pending+=this.decoder.write(buffer.subarray(0,r.bytesRead));}finally{await file.close();}
    const rows=this.pending.split('\n');this.pending=rows.pop();
    if(this.skipPartial&&rows.length){rows.shift();this.skipPartial=false;}
    for(const text of rows){try{consume(JSON.parse(text));}catch{}}
  }
}
