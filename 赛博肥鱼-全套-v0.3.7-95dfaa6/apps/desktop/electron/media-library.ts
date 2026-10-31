import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { stat, copyFile, writeFile, rename, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { dialog, protocol, type BrowserWindow } from 'electron'
import type { MusicTrack } from '../../../packages/shared/src/index'
import { audioByteRange } from './media-range'

export const AUDIO_EXTENSIONS = ['mp3','wav','m4a','ogg','flac','aac','opus']
interface MediaRecord { id: string; filename: string; title: string; artist: string; digest: string }
/** Imported songs are copied into the app's own data folder. Renderer sees only opaque ids. */
export function createMediaLibrary(directory: string) {
  const folder = join(directory, 'media'), catalogFile = join(folder, 'catalog.json')
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  let records: MediaRecord[] = []
  let importing = false
  try { const data = JSON.parse(readFileSync(catalogFile,'utf8')); if(Array.isArray(data)) records = data.filter(r => /^[a-f0-9-]{36}$/.test(r.id) && /^[a-f0-9-]{36}\.[a-z0-9]+$/.test(r.filename)).slice(0, 500) } catch { /* First import. */ }
  const save = async () => { await writeFile(`${catalogFile}.tmp`, JSON.stringify(records,null,2), {mode:0o600}); await rename(`${catalogFile}.tmp`, catalogFile) }
  const track = (r: MediaRecord): MusicTrack => ({ id:r.id,title:r.title,artist:r.artist,source:`shop-media://track/${r.id}` })
  protocol.handle('shop-media', async request => {
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD','Access-Control-Allow-Headers':'Range'}})
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405})
    const url = new URL(request.url), id = url.pathname.slice(1)
    if (url.hostname !== 'track' || !/^[a-f0-9-]{36}$/.test(id)) return new Response('不存在该歌曲',{status:404})
    const entry=records.find(r=>r.id===id)
    if(!entry || !existsSync(join(folder,entry.filename))) return new Response('音频文件缺失',{status:404})
    const path=join(folder,entry.filename),details=await stat(path),range=audioByteRange(request.headers.get('Range'),details.size)
    const headers=new Headers({'Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes'})
    if(!range){headers.set('Content-Range',`bytes */${details.size}`);return new Response(null,{status:416,headers})}
    const contentTypes:Record<string,string>={mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg',flac:'audio/flac',aac:'audio/aac',opus:'audio/ogg'}
    headers.set('Content-Type',contentTypes[extname(entry.filename).slice(1)]||'application/octet-stream')
    headers.set('Content-Length',String(Math.max(0,range.end-range.start+1)))
    if(range.status===206)headers.set('Content-Range',`bytes ${range.start}-${range.end}/${details.size}`)
    const body=request.method==='HEAD'||details.size===0?null:Readable.toWeb(createReadStream(path,{start:range.start,end:range.end})) as unknown as ReadableStream<Uint8Array>
    return new Response(body,{status:range.status,headers})
  })
  return {
    all:()=>records.filter(r=>existsSync(join(folder,r.filename))).map(track),
    async import(window: BrowserWindow) {
      if(importing)throw new Error('正在导入歌曲，请等待当前导入完成。')
      importing=true
      try {
      const result=await dialog.showOpenDialog(window,{title:'导入可用于直播的本地歌曲',properties:['openFile','multiSelections'],filters:[{name:'音频',extensions:AUDIO_EXTENSIONS}]})
      if(result.canceled)return { tracks: [] as MusicTrack[], skipped: 0 }
      const added:MusicTrack[]=[],created:string[]=[],before=[...records]
      let skipped=Math.max(0,result.filePaths.length-100)
      try {
        // Serial, streaming imports keep large files out of the main-process heap
        // and yield to live messages and speech between chunks.
        for(const file of result.filePaths.slice(0,100)) {
          try {
            const extension=extname(file).slice(1).toLowerCase(),details=await stat(file)
            if(!AUDIO_EXTENSIONS.includes(extension)||!details.isFile()||details.size>200*1024*1024){skipped++;continue}
            const hash=createHash('sha256')
            for await (const chunk of createReadStream(file)) hash.update(chunk)
            const digest=hash.digest('hex'),existing=records.find(r=>r.digest===digest)
            if(existing){added.push(track(existing));continue}
            if(records.length>=500){skipped++;continue}
            const id=randomUUID(),filename=`${id}.${extension}`,destination=join(folder,filename)
            await copyFile(file,destination);created.push(destination)
            const entry={id,filename,title:basename(file,extname(file)).slice(0,100),artist:'本地曲库',digest};records.push(entry);added.push(track(entry))
          } catch { skipped++ }
        }
        // Even when some files are invalid, every successful copy is catalogued.
        await save()
      } catch {
        records=before
        await Promise.all(created.map(path=>unlink(path).catch(()=>{})))
        throw new Error('曲库保存失败，已撤销本次新增文件，请检查磁盘空间。')
      }
      return { tracks: added, skipped }
      } finally { importing=false }
    },
    dispose(){protocol.unhandle('shop-media')},
  }
}
