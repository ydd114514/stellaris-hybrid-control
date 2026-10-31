const clean=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
export function audienceEvent(input) {
  if(!input || !['chat','gift'].includes(input.type))return null;
  const name=clean(input.name,22);if(!name)return null;
  const row={type:input.type,name,platform:['bilibili','douyin'].includes(input.platform)?input.platform:'',at:Date.now()};
  if(input.type==='chat'){row.text=clean(input.text,160);return row.text?row:null;}
  row.gift=clean(input.gift,32);row.count=Number.isSafeInteger(input.count)&&input.count>0&&input.count<=100000?input.count:1;return row.gift?row:null;
}
