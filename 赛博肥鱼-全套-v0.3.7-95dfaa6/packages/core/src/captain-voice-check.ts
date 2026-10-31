import type {CaptainSpeechConfig,CaptainVoiceCheck} from '../../shared/src/stellaris-speech'
const code=(value:unknown)=>typeof value==='string'&&/^[a-z\d_.-]{1,80}$/i.test(value)?value:undefined

/** Query existing voice metadata once; never creates, deletes or synthesizes a voice. */
export async function queryCaptainVoice(options:{config:CaptainSpeechConfig;key:string;signal?:AbortSignal;fetch?:typeof fetch}):Promise<CaptainVoiceCheck>{
  const {config}=options
  if(!options.key||options.key.length>4096||/\s/.test(options.key))throw Error('请先保存音色所属账号的百炼密钥。')
  if(config.workspaceId&&!/^[a-z\d-]+$/i.test(config.workspaceId))throw Error('业务空间ID格式不正确。')
  const base=(config.baseUrl||`https://${config.workspaceId}.cn-beijing.maas.aliyuncs.com`).replaceAll('{WorkspaceId}',config.workspaceId).replaceAll('{workspaceId}',config.workspaceId)
  const url=new URL(base)
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('音色查询地址需要不带凭据或查询参数的HTTPS地址。')
  url.pathname=url.pathname.replace(/\/api\/v1\/services\/audio\/tts\/(SpeechSynthesizer|customization)\/?$/,'').replace(/\/$/,'')+'/api/v1/services/audio/tts/customization'
  const controller=new AbortController(),abort=()=>controller.abort()
  if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true})
  const timer=setTimeout(abort,20000)
  try{
    controller.signal.throwIfAborted()
    const response=await (options.fetch||fetch)(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+options.key,'Content-Type':'application/json'},body:JSON.stringify({model:'voice-enrollment',input:{action:'query_voice',voice_id:config.voice}}),signal:controller.signal})
    const reader=response.body?.getReader();if(!reader)throw Error('音色查询未返回有效数据。')
    let text='',size=0;const decoder=new TextDecoder()
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error('音色查询响应过大。')}text+=decoder.decode(value,{stream:true})}text+=decoder.decode()}finally{reader.releaseLock()}
    let body:any;try{body=JSON.parse(text)}catch{throw Error('音色查询未返回有效数据。')}
    const errorCode=code(body.code||body.error?.code),meta={httpStatus:response.status,...(errorCode?{errorCode}:{})}
    if(!response.ok||body.code||body.error){
      const message=errorCode==='AllocationQuota.FreeTierOnly'?'音色查询受免费额度策略限制，请核对当前账号、地域和业务空间权限；这不代表TTS整体不可用。':response.status===401?'音色查询认证失败，请在本机更新所属账号的密钥。':response.status===403?'音色查询权限不足，请核对音色所属账号、地域和业务空间。':'音色查询失败，请核对服务状态和业务空间；本次没有合成音频。'
      return {state:'unknown',message,...meta}
    }
    const output=body.output||{},targetModel=code(output.target_model),serviceStatus=code(output.status)
    const voiceMatches=typeof output.voice_id==='string'?output.voice_id===config.voice:undefined
    const ready=voiceMatches===true&&targetModel===config.model&&serviceStatus==='OK'
    const mismatch=voiceMatches===false||!!targetModel&&targetModel!==config.model||!!serviceStatus&&serviceStatus!=='OK'
    return {state:ready?'ready':mismatch?'unavailable':'unknown',message:ready?'音色状态OK，目标模型匹配。真实合成与试听仍需单独验证。':mismatch?'音色尚不可用，或目标模型/音色与设置不匹配。':'音色详情不完整，尚不能确认可用；请核对所属账号和业务空间。',...meta,...(targetModel?{targetModel}:{}),...(serviceStatus?{serviceStatus}:{}),...(voiceMatches!==undefined?{voiceMatches}:{})}
  }catch{
    if(options.signal?.aborted)throw new DOMException('音色查询已取消。','AbortError')
    throw Error(controller.signal.aborted?'音色查询超时，没有自动重试。':'音色查询未完成，请核对网络和接口地址；没有自动重试。')
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort)}
}
