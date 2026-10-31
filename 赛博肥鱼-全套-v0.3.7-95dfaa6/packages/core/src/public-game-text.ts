/** Public speech has no production-role attribution. This is a final boundary,
 * independent of whether a model followed the prompt. */
export function safePublicGameText(value:unknown,max=90):string {
  if(typeof value!=='string')return ''
  const text=value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060\ufeff]/g,'').trim()
  if(/场\s*控|参\s*谋|老\s*师|主持人|黑板|后台同事|幕后指导|外部指导|\bhost\b|\bstrategist\b|\bcoach\b|\bteacher\b|\bdirector\b/i.test(text.normalize('NFKC')))return ''
  return text.slice(0,max)
}
