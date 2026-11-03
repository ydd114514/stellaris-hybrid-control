// BasicCompactionEngine still handles provider capacity and overflow recovery.
// A normal pressure check for native reasoning starts at an absolute floor.
export const NATIVE_REASONING_COMPACTION_TOKENS=120000;
export function shouldCheckGameCompaction({nativeReasoning,trigger,totalTokens}){
  return !nativeReasoning||trigger!=='pressure'||totalTokens>=NATIVE_REASONING_COMPACTION_TOKENS;
}
