import type {MusicTrack} from '../../shared/src/index'
import {validateTracks,musicLibraryFull} from './jukebox'
import {musicDenied,parseMusicBlacklist} from './music-policy'

/** Merge catalog metadata only. Playback performs the usual lyrics/account checks. */
export function mergeMusicRotation(saved:Record<string,unknown>,incoming:MusicTrack[]){
 const tracks=validateTracks(saved.tracks??[])
 const blacklist=parseMusicBlacklist(typeof saved.blacklist==='string'?saved.blacklist:'')
 const rotation=new Set(Array.isArray(saved.bgmTrackIds)?saved.bgmTrackIds.filter((id):id is string=>typeof id==='string'&&tracks.some(t=>t.id===id)):tracks.map(t=>t.id))
 const bySource=new Map(tracks.map(t=>[t.source,t])),byId=new Map(tracks.map(t=>[t.id,t]))
 const counts={received:incoming.length,addedToLibrary:0,addedToRotation:0,alreadyInRotation:0,blocked:0,invalid:0,capacitySkipped:0}
 const seen=new Set<string>()
 for(const raw of incoming){
  let track:MusicTrack
  try{track=validateTracks([raw])[0]!;if(!/^shop-qqmusic:\/\/track\/[a-zA-Z0-9]{1,64}$/.test(track.source))throw Error()}catch{counts.invalid++;continue}
  if(seen.has(track.source)){counts.alreadyInRotation++;continue}seen.add(track.source)
  if(musicDenied(track,blacklist)){counts.blocked++;continue}
  let target=bySource.get(track.source)
  if(!target){
   if(byId.has(track.id)){counts.invalid++;continue}
   if(musicLibraryFull(tracks)){counts.capacitySkipped++;continue}
   target=track;tracks.push(target);bySource.set(target.source,target);byId.set(target.id,target);counts.addedToLibrary++
  }
  if(rotation.has(target.id)){counts.alreadyInRotation++;continue}
  rotation.add(target.id);counts.addedToRotation++
 }
 return {data:{...saved,tracks,bgmTrackIds:[...rotation]},counts}
}
