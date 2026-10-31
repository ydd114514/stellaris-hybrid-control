import {createHash} from 'node:crypto'

/** Validate actual PCM WAV bytes rather than trusting a manifest's ready flag. */
export function inspectCaptainWav(bytes:Buffer){
  if(bytes.length<44||bytes.length>8388608||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('试听音频文件不完整。')
  let rate=0,align=0,data:Buffer|undefined
  for(let offset=12;offset+8<=bytes.length;){
    const name=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8,end=start+length
    if(end>bytes.length)throw Error('试听音频数据截断。')
    if(name==='fmt '){if(length<16||bytes.readUInt16LE(start)!==1||bytes.readUInt16LE(start+2)!==1||bytes.readUInt16LE(start+14)!==16)throw Error('试听需要单声道PCM16音频。');rate=bytes.readUInt32LE(start+4);align=bytes.readUInt16LE(start+12)}
    if(name==='data')data=bytes.subarray(start,end)
    offset=end+(length%2)
  }
  if(![16000,22050,24000,44100,48000].includes(rate)||align!==2||!data?.length||data.length%2)throw Error('试听音频格式无效。')
  const duration=data.length/rate/2
  if(duration<.1||duration>60)throw Error('试听音频时长无效。')
  let energy=0;for(let i=0;i<data.length;i+=2)energy+=data.readInt16LE(i)**2
  if(Math.sqrt(energy/(data.length/2))<1)throw Error('试听音频没有有效音量。')
  return {duration,sha256:createHash('sha256').update(bytes).digest('hex')}
}

/** Apply the same modest gain and click-free edges to auditions and live PCM. */
export function tuneCaptainWav(bytes:Buffer,gainDb:number,fadeMilliseconds:number){
  inspectCaptainWav(bytes)
  if(!Number.isFinite(gainDb)||gainDb<0||gainDb>6||!Number.isFinite(fadeMilliseconds)||fadeMilliseconds<0||fadeMilliseconds>50)throw Error('语音调音参数无效。')
  const output=Buffer.from(bytes);let rate=0
  for(let offset=12;offset+8<=output.length;){
    const name=output.toString('ascii',offset,offset+4),length=output.readUInt32LE(offset+4),start=offset+8,end=start+length
    if(name==='fmt ')rate=output.readUInt32LE(start+4)
    offset=end+length%2
  }
  for(let offset=12;offset+8<=output.length;){
    const name=output.toString('ascii',offset,offset+4),length=output.readUInt32LE(offset+4),start=offset+8,end=start+length
    if(name==='data'){
      let peak=0;for(let i=start;i<end;i+=2)peak=Math.max(peak,Math.abs(output.readInt16LE(i)))
      // Leave 1 dB headroom even if the next response arrives louder than the sample.
      const gain=Math.min(10**(gainDb/20),32767*10**(-1/20)/Math.max(1,peak)),samples=length/2,fade=Math.round(rate*fadeMilliseconds/1000)
      for(let n=0;n<samples;n++){const envelope=fade?Math.max(0,Math.min(1,n/fade,(samples-1-n)/fade)):1;output.writeInt16LE(Math.round(output.readInt16LE(start+n*2)*gain*envelope),start+n*2)}
    }
    offset=end+length%2
  }
  return output
}
