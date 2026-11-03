// BasicCompactionEngine still handles provider capacity and overflow recovery.
// A normal pressure check for native thinking starts at an absolute floor.
export const NATIVE_REASONING_COMPACTION_TOKENS=120000;
export function shouldCheckGameCompaction({nativeThinking,trigger,totalTokens}){
  return !nativeThinking||trigger!=='pressure'||totalTokens>=NATIVE_REASONING_COMPACTION_TOKENS;
}
