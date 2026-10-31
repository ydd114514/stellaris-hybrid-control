import test from'node:test'
import assert from'node:assert/strict'
import{deflateSync}from'node:zlib'
import{findStarTargets}from'../src/star-targets.mjs'
function fixture(bright=true){
  const width=320,height=240,raw=Buffer.alloc((width*3+1)*height),header=Buffer.alloc(13)
  header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2
  if(bright)for(let y=99;y<=101;y++)for(let x=159;x<=161;x++)raw.fill(255,y*(width*3+1)+1+x*3,y*(width*3+1)+1+x*3+3)
  const chunk=(type,data)=>{const length=Buffer.alloc(4);length.writeUInt32BE(data.length);return Buffer.concat([length,Buffer.from(type),data,Buffer.alloc(4)])}
  const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
  return{width,height,imageBase64:png.toString('base64')}
}
const label={text:'巴纳德星',x:450,y:490,width:100,height:40}
test('visible star core is grounded in source pixels above its OCR name',()=>{
  const stars=findStarTargets(fixture(),[label]);assert.equal(stars.length,1);assert.equal(stars[0].name,label.text)
  assert.equal(stars[0].pixelX,160);assert.equal(stars[0].pixelY,100)
})
test('text without a bright core, UI labels and malformed pictures provide no blind targets',()=>{
  assert.deepEqual(findStarTargets(fixture(false),[label]),[])
  assert.deepEqual(findStarTargets(fixture(),[{...label,x:920}]),[])
  assert.deepEqual(findStarTargets({width:320,height:240,imageBase64:'not-png'},[label]),[])
})
