// SPDX-License-Identifier: MIT
export function byteRange(value:string|null,size:number):[number,number]|null {
  if(!value)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!match||(!match[1]&&!match[2])||size===0)throw new Error('range');
  let start:number,end:number;
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)throw new Error('range');start=Math.max(0,size-suffix);end=size-1;}
  else {start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw new Error('range');
  return [start,Math.min(end,size-1)];
}
