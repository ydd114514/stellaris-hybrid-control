const identity=/(?:场\s*控|参\s*谋|老\s*师|主持人|黑板|幕后指导|外部指导|\bhost\b|\bstrategist\b|\bcoach\b|\bteacher\b|\bdirector\b)/i;
export function hasProductionIdentity(value) {
  const text=typeof value==='string'?value:JSON.stringify(value??'');
  return identity.test(text.normalize('NFKC').replace(/[\u200b-\u200f\u2028-\u202e\u2060\ufeff]/g,''));
}
export function publicGameExplanation(value) {
  const text=typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim():'';
  return hasProductionIdentity(text)?'我先核对当前局势，再安排下一步。':text.slice(0,240);
}
