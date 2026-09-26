export const SIZES=Object.freeze({portrait:{width:1080,height:1440},square:{width:1080,height:1080}});
export function sheetLayout(n,ratio='portrait'){
  if(!Number.isSafeInteger(n)||n<0)throw new Error('INVALID_COUNT');
  if(!SIZES[ratio])throw new Error('INVALID_RATIO');
  if(n>80)throw new Error('OVER_80_POLICY_PENDING'); // no arbitrary first-80 truncation
  const {width,height}=SIZES[ratio],margin=72,innerWidth=936,innerHeight=height-144;
  if(n===0)return {status:'empty',n,width,height,margin,innerWidth,innerHeight,columns:0,rows:0,cells:[]};
  let columns=5;while(columns<=10&&Math.ceil(n/columns)*(innerWidth/columns)+118>innerHeight)columns++;
  if(columns>10)throw new Error('LAYOUT_DOES_NOT_FIT');
  const cell=innerWidth/columns,rows=Math.ceil(n/columns),gridHeight=rows*cell;
  const top=margin+(innerHeight-gridHeight-118)/2,footerTop=top+gridHeight+40;
  const small=cell<126,dateFont=small?24:33,dateLine=small?27:39,dateTop=small?6:9,dateLeft=small?9:12;
  // Match snapshot 5.3 formula, then renderer fits actual ink bounds in the available box.
  const half=.42,scale=Math.min(.78,(cell-dateTop-dateLine-3)/(2*half*cell));
  const dy=Math.max(0,dateTop+dateLine+3-cell*(.5-half*scale)),dx=Math.min(9,cell*.05);
  return {status:'ready',n,width,height,margin,innerWidth,innerHeight,columns,rows,cell,gridHeight,top,footerTop,footerHeight:78,dateFont,dateLine,dateTop,dateLeft,inkScale:scale,inkDx:dx,inkDy:dy,
    cells:Array.from({length:rows*columns},(_,i)=>({x:margin+(i%columns)*cell,y:top+Math.floor(i/columns)*cell,empty:i>=n}))};
}
export function dateTag(day){return day?`${Number(day.slice(5,7))}·${Number(day.slice(8,10))}`:'';}
