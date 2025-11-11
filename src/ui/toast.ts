import Toastify from "toastify-js";
import "toastify-js/src/toastify.css";

const lastShown: Record<string, number> = {};

export function notify(text:string, color="#444", key?:string, cooldownMs=5*60*1000){
  const now = Date.now();
  if(key){
    const last = lastShown[key]||0;
    if(now - last < cooldownMs) return;
    lastShown[key] = now;
  }
  Toastify({ text, gravity:"bottom", position:"right", backgroundColor: color, duration: 3000 }).showToast();
}

export const toastByState: Record<string,{msg:string,color:string}> = {
  focus:     {msg:"집중이 유지되고 있어요!",            color:"#2a7"},
  transition:{msg:"집중이 회복 중입니다.",               color:"#46a"},
  distract:  {msg:"시선이 자주 움직여요. 잠시 정리해요.", color:"#777"},
  fatigue:   {msg:"깜빡임이 느려져요. 눈운동 권장",       color:"#c93"},
  drowsy:    {msg:"졸음 감지! 자리에서 일어나기",         color:"#c44"}
};
