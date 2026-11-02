import {describe,it,expect} from 'vitest'
import {createStellarisWindowPresentation} from '../apps/desktop/electron/stellaris-window'

class FakeWindow {
  visible=false;minimized=false;focused=false;destroyed=false;calls:string[]=[]
  isDestroyed(){return this.destroyed}
  isVisible(){return this.visible}
  isMinimized(){return this.minimized}
  isFocused(){return this.focused}
  show(){this.calls.push('show');this.visible=true;this.focused=true}
  restore(){this.calls.push('restore');this.minimized=false;this.visible=true}
  focus(){this.calls.push('focus');this.focused=true}
}

describe('DSH first-open window presentation',()=>{
  it('successful load shows the first window even without ready-to-show, once only',()=>{
    const window=new FakeWindow(),presentation=createStellarisWindowPresentation({hidden:false,getWindow:()=>window})
    presentation.didLoad();presentation.readyToShow();presentation.didLoad()
    expect(window.calls).toEqual(['show'])
  })
  it('load fallback preserves a window minimized by the user after initial presentation',()=>{
    const window=new FakeWindow(),presentation=createStellarisWindowPresentation({hidden:false,getWindow:()=>window})
    presentation.readyToShow();window.minimized=true;window.visible=false;window.focused=false
    presentation.didLoad()
    expect(window.calls).toEqual(['show']);expect(window.minimized).toBe(true)
  })
  it('a reopen received before window creation waits until content loaded',()=>{
    let window:FakeWindow|undefined
    const presentation=createStellarisWindowPresentation({hidden:false,getWindow:()=>window})
    presentation.requestOpen();window=new FakeWindow();presentation.readyToShow()
    expect(window.calls).toEqual([])
    presentation.didLoad();presentation.didLoad()
    expect(window.calls).toEqual(['show'])
  })
  it('an explicit reopen restores an existing minimized window and activates it',()=>{
    const window=new FakeWindow(),presentation=createStellarisWindowPresentation({hidden:false,getWindow:()=>window})
    presentation.didLoad();window.minimized=true;window.visible=false;window.focused=false
    presentation.requestOpen()
    expect(window.calls).toEqual(['show','restore','focus'])
  })
  it('headless mode never shows, restores, or focuses on startup or reopen',()=>{
    const window=new FakeWindow(),presentation=createStellarisWindowPresentation({hidden:true,getWindow:()=>window})
    window.minimized=true
    presentation.requestOpen();presentation.readyToShow();presentation.didLoad();presentation.requestOpen()
    expect(window.calls).toEqual([])
  })
  it('closing during startup cannot revive the destroyed window',()=>{
    const window=new FakeWindow(),presentation=createStellarisWindowPresentation({hidden:false,getWindow:()=>window})
    presentation.requestOpen();window.destroyed=true
    presentation.didLoad();presentation.readyToShow();presentation.requestOpen()
    expect(window.calls).toEqual([])
  })
})
