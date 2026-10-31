export function controlStatusText(game){
 if(!game)return '等待游戏';
 const survey=game.surveyDelegation||{};
 const positive=value=>Number.isSafeInteger(value)&&value>0;
 if(game.stopped)return positive(survey.uncertain)?'控制已停 · 待核对':'肥鱼休息中';
 if(positive(survey.uncertain))return game.paused?'暂停核对控制权':'正在核对控制权';
 if(game.executionKnown===false)return '局势待核对';
 if(game.paused)return '肥鱼休息中';
 if(positive(survey.working))return '肥鱼指挥 · 自动调查';
 if(positive(survey.assigned))return '肥鱼指挥 · 调查待命';
 return '肥鱼正在玩';
}
