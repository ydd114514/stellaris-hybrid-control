interface StartupWindow {
  isDestroyed():boolean
  isVisible():boolean
  isMinimized():boolean
  isFocused():boolean
  show():void
  restore():void
  focus():void
}

/** Initial presentation has a load fallback; only a user reopen requests activation. */
export function createStellarisWindowPresentation(options:{hidden:boolean;getWindow():StartupWindow|undefined}){
  let presented=false,loaded=false,openPending=false
  function current(){const window=options.getWindow();return window&&!window.isDestroyed()?window:undefined}
  function present(){
    if(options.hidden||presented||openPending&&!loaded)return
    const window=current();if(!window)return
    presented=true
    if(!window.isVisible())window.show()
  }
  function activate(){
    if(options.hidden||!loaded||!openPending)return
    const window=current();if(!window)return
    openPending=false
    if(window.isMinimized())window.restore()
    if(!window.isVisible())window.show()
    if(!window.isFocused())window.focus()
  }
  return {
    readyToShow:present,
    didLoad(){loaded=true;present();activate()},
    requestOpen(){if(options.hidden)return;openPending=true;activate()},
  }
}
