import {describe,it,expect} from 'vitest'
import {inspectCaptainWav,tuneCaptainWav} from '../packages/core/src/captain-audio'
import {pcmWav} from '../apps/desktop/electron/stellaris-speech'

describe('captain live gain and fade',()=>{
 it('raises quiet speech, preserves the source, and fades both ends at the actual sample rate',()=>{
  const pcm=Buffer.alloc(3200);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(1000,i)
  const raw=pcmWav(pcm.toString('base64'),16000),before=Buffer.from(raw),output=tuneCaptainWav(raw,3,10)
  expect(raw).toEqual(before);expect(output.readInt16LE(44)).toBe(0);expect(output.readInt16LE(output.length-2)).toBe(0)
  expect(output.readInt16LE(44+80*2)).toBeCloseTo(706,0);expect(output.readInt16LE(44+160*2)).toBe(1413)
  expect(inspectCaptainWav(output).duration).toBe(.1)
 })
 it('leaves headroom for loud responses and preserves extra RIFF chunks',()=>{
  const pcm=Buffer.alloc(4800);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(i%4?32767:-32768,i)
  const wav=pcmWav(pcm.toString('base64'),24000),junk=Buffer.from('JUNK\x04\x00\x00\x00keep'),raw=Buffer.concat([wav.subarray(0,36),junk,wav.subarray(36)])
  raw.writeUInt32LE(raw.length-8,4)
  const output=tuneCaptainWav(raw,3,10);expect(output.subarray(36,48)).toEqual(junk);expect(inspectCaptainWav(output).duration).toBe(.1)
  let peak=0;for(let i=56;i<output.length;i+=2)peak=Math.max(peak,Math.abs(output.readInt16LE(i)))
  expect(peak).toBeGreaterThan(29000);expect(peak).toBeLessThanOrEqual(29204)
  expect(()=>tuneCaptainWav(raw,Infinity,10)).toThrow();expect(()=>tuneCaptainWav(raw,3,-1)).toThrow()
 })
})
