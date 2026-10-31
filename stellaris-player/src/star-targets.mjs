import{inflateSync}from'node:zlib'

/** Identify a visible star's bright core immediately above an OCR name.
 * Source is only our local unfiltered RGB PNG. No save/hidden galaxy data.
 */
export function findStarTargets(image,labels){
  try{
    const png=Buffer.from(image.imageBase64,'base64')
    if(png.length<33||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')return[]
    const width=png.readUInt32BE(16),height=png.readUInt32BE(20)
    if(width!==image.width||height!==image.height||width*height>16777216||png[24]!==8||png[25]!==2)return[]
    const chunks=[]
    for(let at=8;at+12<=png.length;){const size=png.readUInt32BE(at);if(at+size+12>png.length)return[];if(png.toString('ascii',at+4,at+8)==='IDAT')chunks.push(png.subarray(at+8,at+8+size));at+=size+12}
    const stride=width*3+1,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:stride*height})
    if(raw.length!==stride*height)return[]
    for(let y=0;y<height;y++)if(raw[y*stride]!==0)return[]
    const result=[]
    for(const label of labels){
      if(!label?.text||label.text.length>18||!/[\p{L}\p{Script=Han}]/u.test(label.text))continue
      const x=(label.x+label.width/2)*width/1000,y=label.y*height/1000
      if(x<width*.12||x>width*.85||y<height*.08||y>height*.90||label.height*height/1000>28)continue
      let best
      for(let py=Math.max(2,Math.floor(y-65));py<Math.min(height-2,y-3);py++)for(let px=Math.max(2,Math.floor(x-65));px<Math.min(width-2,x+65);px++){
        const at=py*stride+1+px*3
        if(Math.min(raw[at],raw[at+1],raw[at+2])<215)continue
        let mean=0
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const i=(py+dy)*stride+1+(px+dx)*3;mean+=(raw[i]+raw[i+1]+raw[i+2])/27}
        if(mean<220)continue
        const distance=Math.hypot(px-x,py-(y-14)),score=mean-distance*.7
        if(!best||score>best.score)best={px,py,score}
      }
      if(!best||result.some(star=>Math.hypot(star.pixelX-best.px,star.pixelY-best.py)<15))continue
      result.push({id:`s${result.length}`,name:label.text,x:Math.round(best.px/width*100000)/100,y:Math.round(best.py/height*100000)/100,pixelX:best.px,pixelY:best.py,evidence:'本轮文字锚点上方的明亮星核'})
    }
    // Names in dim map text may not OCR. A compact white core surrounded by
    // glow in at least three directions still supplies a visible target; it
    // is explicitly unnamed rather than inventing a system identity.
    const seen=new Uint8Array(width*height)
    const bright=(x,y)=>{const at=y*stride+1+x*3;return Math.min(raw[at],raw[at+1],raw[at+2])>=225}
    for(let y=Math.floor(height*.08);y<height*.88;y+=2)for(let x=Math.floor(width*.13);x<width*.85;x+=2){
      if(x<width*.27&&y>height*.65||seen[y*width+x]||!bright(x,y))continue
      const queue=[[x,y]],component=[];seen[y*width+x]=1
      for(let i=0;i<queue.length&&i<1500;i++){
        const[px,py]=queue[i];component.push([px,py])
        for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=px+dx,ny=py+dy;if(nx>1&&ny>1&&nx<width-2&&ny<height-2&&!seen[ny*width+nx]&&bright(nx,ny)){seen[ny*width+nx]=1;queue.push([nx,ny])}}
      }
      if(component.length<5||queue.length>=1500)continue
      const xs=component.map(p=>p[0]),ys=component.map(p=>p[1]),w=Math.max(...xs)-Math.min(...xs)+1,h=Math.max(...ys)-Math.min(...ys)+1
      if(w>35||h>35||w/h<.45||w/h>2.2)continue
      const px=Math.round(xs.reduce((a,b)=>a+b,0)/xs.length),py=Math.round(ys.reduce((a,b)=>a+b,0)/ys.length)
      if(labels.some(label=>label.height*height/1000>30&&px>label.x*width/1000-4&&px<(label.x+label.width)*width/1000+4&&py>label.y*height/1000-4&&py<(label.y+label.height)*height/1000+4))continue
      let glow=0
      for(const[dx,dy]of[[8,0],[-8,0],[0,8],[0,-8]]){const at=(py+dy)*stride+1+(px+dx)*3;if((raw[at]+raw[at+1]+raw[at+2])/3>65)glow++}
      if(glow<3||result.some(star=>Math.hypot(star.pixelX-px,star.pixelY-py)<18))continue
      result.push({id:`s${result.length}`,name:`未识别名称的可见星点${result.length}`,x:Math.round(px/width*100000)/100,y:Math.round(py/height*100000)/100,pixelX:px,pixelY:py,evidence:'本轮画面中的明亮星核及周围辉光',unnamed:true})
    }
    return result.slice(0,30)
  }catch{return[]}
}
