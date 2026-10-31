// Keep the tested production default. Ninety seconds is an explicit experiment
// below the existing 120-second MCP timeout; local protection still polls at 1s.
export function surveyWatchWindow(value=60){
 if(![60,90].includes(value))throw Error('原生调查等待上限仅支持60或90秒');
 return value;
}
