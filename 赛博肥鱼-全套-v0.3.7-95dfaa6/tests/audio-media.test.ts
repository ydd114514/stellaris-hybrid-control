import { describe, expect, it } from 'vitest'
import { audioByteRange } from '../apps/desktop/electron/media-range'

describe('本地歌曲流式字节范围',()=>{
  it('普通读取与精确区间、开放结尾、后缀读取保持正确长度',()=>{
    expect(audioByteRange(null,100)).toEqual({start:0,end:99,status:200})
    expect(audioByteRange('bytes=0-43',100)).toEqual({start:0,end:43,status:206})
    expect(audioByteRange('bytes=50-',100)).toEqual({start:50,end:99,status:206})
    expect(audioByteRange('bytes=-20',100)).toEqual({start:80,end:99,status:206})
    expect(audioByteRange('bytes=90-200',100)).toEqual({start:90,end:99,status:206})
  })
  it('越界、反向、空区间、多区间及非安全整数返回416判定',()=>{
    for(const value of ['bytes=100-101','bytes=50-10','bytes=-0','bytes=-','bytes=0-1,4-5','bytes=999999999999999999999-','garbage'])expect(audioByteRange(value,100)).toBeUndefined()
    expect(audioByteRange('bytes=0-',0)).toBeUndefined()
    expect(audioByteRange(null,0)).toEqual({start:0,end:-1,status:200})
  })
})
