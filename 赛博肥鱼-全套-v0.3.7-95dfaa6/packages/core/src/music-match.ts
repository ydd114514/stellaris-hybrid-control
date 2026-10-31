import type { MusicTrack } from '../../shared/src/index'

export const normalizeMusicText = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
const versions = [/(?:伴奏|伴唱|instrumental|karaoke|卡拉)/i, /(?:翻唱|\bcover\b)/i, /(?:\blive\b|现场|演唱会)/i, /(?:\bremix\b|混音)/i, /(?:\bdj\b|dj版)/i, /(?:加速|降调|升调|变速|铃声)/i]
const matchText = (value: string) => normalizeMusicText(value.normalize('NFKC').replace(/(?:\blive\b(?:版)?|现场版?|演唱会版?)/gi, 'live').replace(/(?:\bremix\b(?:版)?|混音版?)/gi, 'remix'))

/** Exact title/artist matching; punctuation and artist order do not change identity. */
export function musicMatchScore(track: Pick<MusicTrack, 'title' | 'artist'>, query: string): number {
  const metadata = `${track.title} ${track.artist}`.normalize('NFKC')
  if (versions.some(version => version.test(metadata) !== version.test(query.normalize('NFKC')))) return -1
  const full = matchText(track.title)
  const base = matchText(track.title.normalize('NFKC').replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, ''))
  const q = matchText(query)
  const titles = [...new Set([full, base, base.match(/\p{Script=Han}+/gu)?.join('') || '', base.replace(/\p{Script=Han}/gu, '')].filter(Boolean))]
  if (titles.includes(q)) return 100
  const artists = track.artist.split(/\s*[/、&,，]\s*/).map(matchText).filter(value => value && value !== '未知歌手').sort((a, b) => b.length - a.length)
  // Only remove artist names from the edges, so a singer inside a song title
  // cannot turn a different title into a match. Support either order and duets.
  const remaining = new Set([q])
  for (const value of remaining) for (const artist of artists) {
    if (value.startsWith(artist)) remaining.add(value.slice(artist.length))
    if (value.endsWith(artist)) remaining.add(value.slice(0, -artist.length))
  }
  return [...remaining].some(value => value !== q && titles.includes(value)) ? 200 : -1
}

export function musicSearchQueries(query: string): string[] {
  const clean = query.normalize('NFKC').replace(/[《》「」“”"']/g, '').replace(/\s*[-—–|:：/,，、;；]\s*/g, ' ').replace(/\s+/g, ' ').trim()
  const parts = clean.split(' ')
  // Preserve multiword song names when dropping a trailing/leading artist.
  const cuts = Array.from({length: parts.length - 1}, (_, i) => i + 1).sort((a, b) => Math.abs(a - parts.length / 2) - Math.abs(b - parts.length / 2) || b - a)
  return [...new Set([clean, ...cuts.flatMap(cut => [parts.slice(0, cut).join(' '), parts.slice(cut).join(' ')])])].filter(Boolean).slice(0, 5)
}
