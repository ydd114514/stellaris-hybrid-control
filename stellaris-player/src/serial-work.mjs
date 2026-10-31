// The native pipe supports one outstanding request. Idle monitoring and tools
// share this queue; idle ticks never accumulate behind a long watch/tool call.
export class SerialWork {
  pending=0;tail=Promise.resolve();
  run(task){
    this.pending++;
    const result=this.tail.then(task).finally(()=>{this.pending--;});
    this.tail=result.catch(()=>{});return result;
  }
  idle(task){return this.pending?Promise.resolve(false):this.run(task).then(()=>true);}
  drain(){return this.tail;}
}
