import { db } from "../db";

export async function getFramesInRange(start:number, end:number){
  return db.frames.where('ts').between(start, end, true, true).toArray();
}
export function sumMinutes(frames: {ts:number,state:string}[], state:string){
  const cnt = frames.filter(f=>f.state===state).length;
  return Math.round(cnt/60);
}
export function avgFocus(frames:{focusScore:number}[]){
  if(!frames.length) return 0;
  return Math.round(frames.reduce((a,b)=>a+b.focusScore,0)/frames.length);
}
