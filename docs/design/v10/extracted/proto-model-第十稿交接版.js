// 拾字 · 第九稿可点原型的演示数据与存储（1.3、1.4；第二批加录制数据存储 5.2）。不接真实算法、不读生产存储。
// 第十稿：加 馨、鼎（自选了还没写）、K14 的三个春天的字、300 个字的演示数据（同画布）、写错过 / 快忘了的判定（K15、K16，快忘了按“三个月以上没写”模拟）
(function(){
  const KEY='shizi-proto-v9', VERSION=4, TODAY='9-24'; // VERSION 4：第十稿走查核对 V05 清掉补记的痕迹（记录的 bk、backfilled），旧的演示存储自动重置一次
  // 1.4 三十个样本字的出题数据。词语：写字组件 CHARS 与 ShiziScreen 的 WORD；「静」取单字详情的「平静」。
  // 没有词语的走「拼音 + 释义」（照「亦」；性…斯 17 个字的拼音和释义是原型示意，待字库定稿）；fb = 没有部件分组数据，提示退回「前几笔」（前 1 笔 → 前 2 笔 → 看答案，待定）
  const FB=[[0],[1],[2]];
  const SAMPLES={
    数:{py:'shù',word:['人','数'],blank:1,groups:[[0,1,2,3,4,5],[6,7,8],[9,10,11,12]]},
    感:{py:'gǎn',word:['感','到'],blank:0,groups:[[0,1,2,3,4,5,6,7,8],[9,10,11,12]]},
    警:{py:'jǐng',word:['军','警'],blank:1,groups:[[0,1,2],[3,4,5,6,7],[8,9,10,11],[12,13,14,15,16,17,18]]},
    部:{py:'bù',word:['部','分'],blank:0,groups:[[0,1,2,3,4,5,6,7],[8,9]]},
    户:{py:'hù',word:['用','户'],blank:1,groups:[[0,1,2,3]]},
    主:{py:'zhǔ',word:['主','要'],blank:0,groups:[[0,1,2,3,4]]},
    虽:{py:'suī',word:['虽','然'],blank:0,groups:[[0,1,2],[3,4,5,6,7,8]]},
    亦:{py:'yì',word:[],blank:0,gloss:'也；又',groups:[[0,1,2,3,4,5]]},
    题:{py:'tí',word:['问','题'],blank:1,groups:FB,fb:1},
    整:{py:'zhěng',word:['整','个'],blank:0,groups:FB,fb:1},
    豕:{py:'shǐ',word:['三','豕','涉','河'],blank:1,groups:FB,fb:1},
    额:{py:'é',word:['总','额'],blank:1,groups:FB,fb:1},
    静:{py:'jìng',word:['平','静'],blank:1,groups:FB,fb:1},
    性:{py:'xìng',word:[],blank:0,gloss:'本质；脾气',groups:FB,fb:1},
    体:{py:'tǐ',word:[],blank:0,gloss:'身躯；形状',groups:FB,fb:1},
    次:{py:'cì',word:[],blank:0,gloss:'第二；顺序',groups:FB,fb:1},
    教:{py:'jiāo',word:[],blank:0,gloss:'传授；指导',groups:FB,fb:1},
    女:{py:'nǚ',word:[],blank:0,gloss:'与男相对',groups:FB,fb:1},
    期:{py:'qī',word:[],blank:0,gloss:'约定的时日；盼望',groups:FB,fb:1},
    境:{py:'jìng',word:[],blank:0,gloss:'疆界；地方',groups:FB,fb:1},
    越:{py:'yuè',word:[],blank:0,gloss:'跨过；超出',groups:FB,fb:1},
    惊:{py:'jīng',word:[],blank:0,gloss:'害怕；震动',groups:FB,fb:1},
    谁:{py:'shéi',word:[],blank:0,gloss:'哪个人',groups:FB,fb:1},
    份:{py:'fèn',word:[],blank:0,gloss:'整体中的一部分',groups:FB,fb:1},
    慢:{py:'màn',word:[],blank:0,gloss:'速度低；迟缓',groups:FB,fb:1},
    鲜:{py:'xiān',word:[],blank:0,gloss:'新的；味美',groups:FB,fb:1},
    俄:{py:'é',word:[],blank:0,gloss:'片刻；短时间',groups:FB,fb:1},
    既:{py:'jì',word:[],blank:0,gloss:'已经',groups:FB,fb:1},
    您:{py:'nín',word:[],blank:0,gloss:'“你”的敬称',groups:FB,fb:1},
    斯:{py:'sī',word:[],blank:0,gloss:'这；此',groups:FB,fb:1},
    // 第十稿：自选了还没写（馨、鼎；300 个字另有瓷）、查字示例「感慨」的慨、K14 春天的三个字（茂、桥、碑）
    馨:{py:'xīn',word:['温','馨'],blank:1,groups:FB,fb:1},
    鼎:{py:'dǐng',word:['鼎','盛'],blank:0,groups:FB,fb:1},
    瓷:{py:'cí',word:['陶','瓷'],blank:1,groups:FB,fb:1},
    慨:{py:'kǎi',word:['慷','慨'],blank:1,groups:FB,fb:1},
    茂:{py:'mào',word:['茂','盛'],blank:0,groups:FB,fb:1},
    桥:{py:'qiáo',word:['大','桥'],blank:1,groups:FB,fb:1},
    碑:{py:'bēi',word:['石','碑'],blank:1,groups:FB,fb:1}
  };
  // 300 个字里另外 270 个字的读音（多音字取第一个读音）：只给拼音排序和写字页的题面用；这些字没有词语和释义（原型示意）
  const PYX={};('餐cān 馒mán 馅xiàn 饼bǐng 馆guǎn 饿è 锅guō 碗wǎn 筷kuài 盘pán 碟dié 壶hú 瓶píng 罐guàn 箱xiāng 篮lán 筐kuāng 袋dài 裙qún 裤kù 袜wà 鞋xié 帽mào 镜jìng 梳shū 扇shàn 伞sǎn 烛zhú 炉lú 煤méi 燃rán 烧shāo 烤kǎo 煮zhǔ 蒸zhēng 炒chǎo 炸zhá 厨chú 厕cè 卧wò 厅tīng 廊láng 墙qiáng 壁bì 砖zhuān 梯tī 栏lán 柱zhù 棚péng 窗chuāng 帘lián 锁suǒ 钥yào 匙chí 链liàn 钉dīng 锤chuí 锯jù 铲chǎn 锄chú 镰lián 犁lí 耕gēng 播bō 撒sā 灌guàn 溉gài 浇jiāo 堆duī 肥féi 稻dào 麦mài 粱liáng 穗suì 棉mián 蔬shū 葱cōng 蒜suàn 椒jiāo 薯shǔ 萝luó 茄qié 藕ǒu 莲lián 荷hé 菊jú 梅méi 兰lán 竹zhú 松sōng 柏bǎi 杨yáng 柳liǔ 槐huái 桑sāng 梨lí 桃táo 橘jú 橙chéng 柿shì 葡pú 萄táo 蕉jiāo 樱yīng 莓méi 雷léi 霜shuāng 雾wù 露lù 霞xiá 虹hóng 瀑pù 溪xī 潭tán 湖hú 泊bó 滩tān 涛tāo 浪làng 澜lán 波bō 泉quán 源yuán 渠qú 堤dī 坝bà 岸àn 崖yá 峰fēng 岭lǐng 峡xiá 谷gǔ 坡pō 丘qiū 陵líng 岩yán 矿kuàng 泥ní 沙shā 砾lì 尘chén 埃āi 冰bīng 雹báo 雪xuě 飘piāo 晴qíng 暖nuǎn 晨chén 晚wǎn 暮mù 夜yè 宵xiāo 鹅é 鸭yā 鸽gē 雀què 鹊què 鹰yīng 鹤hè 燕yàn 蝶dié 蜂fēng 蜜mì 蚁yǐ 蚊wén 蝇yíng 蛙wā 蛇shé 蚕cán 虾xiā 蟹xiè 鲸jīng 鲨shā 鳄è 龟guī 猴hóu 猪zhū 狗gǒu 猫māo 鼠shǔ 兔tù 豹bào 狼láng 狐hú 狸lí 熊xióng 猩xīng 骆luò 驼tuó 骡luó 驴lǘ 臂bì 腕wàn 腰yāo 膝xī 脖bó 腮sāi 眉méi 睫jié 瞳tóng 嘴zuǐ 唇chún 舌shé 牙yá 喉hóu 胸xiōng 肺fèi 肝gān 胃wèi 肠cháng 肾shèn 骨gǔ 脊jǐ 趾zhǐ 蹲dūn 跪guì 跳tiào 蹦bèng 踢tī 踩cǎi 攀pān 爬pá 抓zhuā 握wò 捧pěng 搬bān 拖tuō 撑chēng 扶fú 摸mō 捏niē 挠náo 揉róu 搓cuō 撕sī 折zhé 愉yú 悦yuè 惆chóu 怅chàng 惭cán 愧kuì 慌huāng 恐kǒng 惧jù 恨hèn 怨yuàn 愁chóu 憾hàn 悔huǐ 懒lǎn 惰duò 勤qín 勉miǎn 谦qiān 逊xùn 骄jiāo 傲ào 羡xiàn 慕mù 嫉jí 妒dù 恭gōng 敬jìng 赞zàn 叹tàn 蕴yùn 含hán 酝yùn 酿niàng 憧chōng 憬jǐng 徘pái 徊huái 踌chóu 躇chú 犹yóu 豫yù').split(' ').forEach(s=>{PYX[s[0]]=s.slice(1);});
  const XS=Object.keys(PYX).join('');
  // 演示里的字都能练；300 个字里另外 270 个字只有拼音题面（原型示意），其他字练不了
  const item=c=>SAMPLES[c]?Object.assign({c},SAMPLES[c]):{c,py:PYX[c]||'',word:[],blank:0,gloss:'',groups:FB,fb:1};
  const canPractice=c=>!!(SAMPLES[c]||PYX[c]);
  const pyOf=c=>(SAMPLES[c]&&SAMPLES[c].py)||PYX[c]||'';
  // 第十稿走查 K26：第一次练习 5 个字
  const QUEUES={first:'部主性体次'.split(''),ord:'数感警部户主虽'.split(''),again:'静题慢亦额'.split('')};
  // 逐字抄自 ShiziScreen 的 DAYS（v: R 写对 · W 写错 · S 跳过 · A 看过答案；第三项空着（原来是补记的日子，第十稿走查 K27 去掉）；第四项 = 看过答案）
  // 第十稿 K14：补三个春天的字（茂、桥、碑），最近一次都在三个月以前，快忘了按“三个月以上没写”能选出 3 个字
  const SPRING=[['3-28',[['茂','R'],['桥','R']]],['4-18',[['碑','R'],['茂','R']]]];
  const DAYS=[...SPRING,
   ['8-12',[['部','R'],['主','R'],['性','R'],['体','R'],['次','R'],['教','R'],['女','R'],['数','R'],['感','R'],['期','R'],['境','W'],['整','R'],['越','R'],['虽','S'],['惊','A']]],
   ['8-20',[['虽','R'],['惊','W']]],
   ['8-28',[['整','R'],['越','R']]],
   ['9-1',[['静','R'],['谁','R'],['份','R'],['户','R'],['题','W']]],
   ['9-8',[['静','W'],['慢','R'],['亦','R']]],
   ['9-14',[['额','W'],['鲜','R'],['境','R']]],
   ['9-16',[['惊','R'],['俄','R'],['既','R']]],
   ['9-22',[['您','R'],['斯','R'],['豕','W'],['期','R'],['次','R'],['静','R'],['题','W'],['整','W'],['体','R']]],
   ['9-24',[['数','R'],['感','R'],['警','W'],['部','R'],['户','S'],['主','R'],['虽','R']]]
  ];
  const CUSTOM=['豕','鲜','额','亦','俄','斯','既','您','慢','馨','鼎'];
  const USER_STATES=[
    ['first','第一次来'],['noToday','今天还没记录'],['today','今天有记录'],
    ['ordHalf','普通练习写到一半、今天还没记录'],['pickHalf','这次选的字写到一半'],['bothHalf','普通练习和这次选的字都写到一半'],['firstHalf','首次练习写到一半']
  ];

  function seed(days){const records=[],events=[];let n=0;
    days.forEach(([d,cs])=>cs.forEach(([c,v,_,hp],i)=>{const o={id:'d'+(++n),c,d,v,i,help:hp?'answer':''};(v==='R'||v==='W'?records:events).push(o);}));
    return {records,events};}
  function session(s,kind,queue,src){return {id:'s'+(++s.serial),kind,src,queue:[...queue],i:0,phase:'recall',hints:0,used:0,saw:false,strokes:[],sim:0,line:null,lastRid:null,items:[],done:false,diff:null};}
  // 日期：m-d（2026 年，不跨年）→ 一年里的第几天
  const ML=[31,28,31,30,31,30,31,31,30,31,30,31], CUM=[0]; ML.forEach((l,i)=>CUM.push(CUM[i]+l));
  const doy=d=>{const a=d.split('-');return CUM[a[0]-1]+(+a[1]);};
  const toD=x=>{let m=0;while(x>CUM[m+1])m++;return (m+1)+'-'+(x-CUM[m]);};
  const ago=(d,today)=>doy(today||TODAY)-doy(d);
  // K15 写错过：只看最近一次有效记录（写对 / 写错）；跳过、只看答案不是有效记录。K16 快忘了：原型按“最近一次有效记录在三个月（90 天）以前、判断写对”模拟，最多 12 个，最久没写的排前；写错的只进写错过，两张清单不重叠
  function lists(records,today){ const latest={}; (records||[]).forEach(r=>{ if(r.v!=='R'&&r.v!=='W') return; const p=latest[r.c]; if(!p||doy(r.d)>doy(p.d)||(doy(r.d)===doy(p.d)&&(r.i||0)>=(p.i||0))) latest[r.c]=r; });
    const L=Object.values(latest), byNew=(a,b)=>doy(b.d)-doy(a.d)||(b.i||0)-(a.i||0);
    const wrong=L.filter(r=>r.v==='W').sort(byNew), old=L.filter(r=>r.v==='R'&&ago(r.d,today)>90).sort((a,b)=>doy(a.d)-doy(b.d)||(a.i||0)-(b.i||0));
    return {latest,wrong,forget:old.slice(0,12),forgetAll:old.length}; }
  // 300 个字（同画布「字库墨墙屏」n=300 那套）：现在的 30 个字 + 手挑的 270 个规范常用字；第一次写在 2 月 10 日到 9 月 19 日之间，之后按 3 / 8 / 20 / 45 / 90 天复习，每次有两成概率不再复习；另有 3 个字最近一次判断写错
  function extra300(base30){ const IN=new Set(base30), EX=(()=>{const a=[...new Set(XS)].filter(c=>!IN.has(c)&&!'馨鼎瓷感慨拾'.includes(c));let s=17;const r=()=>{s=(s*9301+49297)%233280;return s/233280;};for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,270);})();
    const IV=[3,8,20,45,90,180], T=doy(TODAY), out=[], NR={}; let s=7; const r=()=>{s=(s*9301+49297)%233280;return s/233280;};
    EX.forEach((c,k)=>{const f=41+Math.floor(k*222/270)+Math.floor(r()*3);let t=f,j=0;const ds=[f];
      while(j<IV.length){if(r()<.2)break;t=t+IV[j]+Math.round(r()*IV[j]*.3);if(t>T)break;ds.push(t);j++;}
      NR[c]=ds.length; ds.forEach(x=>out.push({c,d:toD(x),v:'R',i:10+k}));});
    let n=0; EX.forEach(c=>{if(n>=3)return;const rs=out.filter(o=>o.c===c),l=rs[rs.length-1];if(rs.length>=2&&l.d.startsWith('9-')){l.v='W';n++;}});
    return {EX,NR,IV,records:out}; }
  function demo300(){ const base=seed(DAYS.filter(d=>!SPRING.includes(d))), ex=extra300([...new Set(base.records.map(r=>r.c))]);
    let n=0; const records=base.records.concat(ex.records.map(o=>Object.assign({id:'x'+(++n),help:''},o))).sort((a,b)=>doy(a.d)-doy(b.d)||a.i-b.i);
    return {records,events:base.events,added:[...CUSTOM,'瓷'],EX:ex.EX,NR:ex.NR,IV:ex.IV}; }
  function build(us,opt){
    const base=build0(us,opt);
    // 第十稿 10.12：笔迹缺失的样例——静最近一次（9 月 22 日）和感最近一次（9 月 24 日）有记录、没有留下笔迹（更早一次有笔迹）；体 9 月 22 日只有形状、没有 t / p
    if(opt&&opt.ink){ base.inkDemo=true; const mk=(c,d,ink)=>{ const r=base.records.filter(x=>x.c===c&&x.d===d).pop(); if(r) r.ink=ink; }; mk('静','9-22','none'); mk('感','9-24','none'); mk('体','9-22','shape'); }
    return base; }
  function build0(us,opt){
    const base={version:VERSION,userState:us,serial:0,introSeen:true,view:{name:'home'},A:null,B:null,added:[...CUSTOM],lastBackup:'9-1',library:'规范常用字',diffs:[],...seed(DAYS.filter(d=>d[0]!==TODAY))};
    if(opt&&opt.big){ const D=demo300(); Object.assign(base,{userState:'today',big:true,records:D.records,events:D.events,added:D.added}); return base; }
    if(us==='first'||us==='firstHalf'){Object.assign(base,{introSeen:us==='firstHalf',records:[],events:[],added:[],lastBackup:null});}
    if(us==='today') Object.assign(base,seed(DAYS));
    if(us==='ordHalf'||us==='bothHalf'){
      // 停在第 3 个字的回忆阶段，同时今天还没有记录：前两个字按跳过记（见异议）
      const A=session(base,'ord',QUEUES.ord,'home');A.i=2;
      A.items=[{c:'数',v:'S'},{c:'感',v:'S'}];base.events.push({id:'e-a1',c:'数',d:TODAY,v:'S',i:0,sid:A.id},{id:'e-a2',c:'感',d:TODAY,v:'S',i:1,sid:A.id});base.A=A;}
    if(us==='pickHalf'||us==='bothHalf'){
      // 这次选的字：额、鲜、境（照 endPicked），从首页开始；停在第 1 个字，已写了前 3 笔
      const B=session(base,'pick',['额','鲜','境'],'home');B.sim='part';base.B=B;}
    if(us==='firstHalf'){
      const A=session(base,'first',QUEUES.first,'home');A.i=3;
      ['部','主','性'].forEach((c,i)=>{const id='f'+i;base.records.push({id,c,d:TODAY,v:'R',i,help:'',sid:A.id});A.items.push({c,v:'R',rid:id});});
      A.lastRid='f2';A.line='record';A.remind='ask';base.A=A;}
    return base;}

  // 笔迹：内存里是 [[{x,y,w}]]，存储时压成字符串（保留 1 位小数）
  const enc=st=>(st||[]).map(p=>p.map(q=>[q.x,q.y,q.w].map(v=>Math.round(v*10)/10).join(',')).join(';')).join('|');
  const dec=s=>s?s.split('|').map(ps=>ps?ps.split(';').map(q=>{const a=q.split(',').map(Number);return {x:a[0],y:a[1],w:a[2]};}):[]):[];
  const pack=st=>JSON.stringify(st,(k,v)=>k==='strokes'&&Array.isArray(v)?enc(v):v);
  function unpack(raw){return JSON.parse(raw,(k,v)=>k==='strokes'&&typeof v==='string'?dec(v):v);}

  // 1.3 存储：只用一个键；读写都包 try/catch
  function probe(){try{const k=KEY+'-probe';localStorage.setItem(k,'1');localStorage.removeItem(k);return true;}catch(e){return false;}}
  function load(){
    if(!probe()) return {blocked:true};
    let raw=null;try{raw=localStorage.getItem(KEY);}catch(e){return {blocked:true};}
    if(!raw) return {state:null};
    try{const s=unpack(raw);if(!s||s.version!==VERSION||!Array.isArray(s.records)) return {state:null,reset:'演示数据的版本对不上，已自动重置演示。'};return {state:s};}
    catch(e){return {state:null,reset:'演示数据解析失败，已自动重置演示。'};}
  }
  function save(st){try{localStorage.setItem(KEY,pack(st));return true;}catch(e){return false;}}

  // 2.1 / 2.10 恢复：备份文件里的数据 = DAYS 里 9 月 1 日及以前的记录
  const dn=d=>{const a=d.split('-').map(Number);return a[0]*100+a[1];};
  function restoreData(){return seed(DAYS.filter(d=>dn(d[0])<=dn('9-1')));}
  window.SZProto={KEY,VERSION,TODAY,SAMPLES,QUEUES,DAYS,CUSTOM,USER_STATES,item,canPractice,pyOf,PYX,build,session,load,save,enc,dec,seed,restoreData,doy,toD,ago,lists,extra300,demo300};

  // 5.2 录制数据：IndexedDB shizi-proto-v9-rec（不可用时退到 localStorage 同名键），和演示数据分开；重置演示、清空所有记录都不动它
  const DB='shizi-proto-v9-rec';
  window.SZRec=window.SZRec||{
    db:null,
    open(){ if(this._p) return this._p; this._p=new Promise(res=>{ try{ const q=indexedDB.open(DB,1); q.onupgradeneeded=()=>{const d=q.result; d.createObjectStore('recs',{keyPath:'key'}); d.createObjectStore('writers',{keyPath:'id'});}; q.onsuccess=()=>{this.db=q.result;res(true);}; q.onerror=()=>res(false); }catch(e){res(false);} }); return this._p; },
    tx(store,mode,fn){ return new Promise((res,rej)=>{ try{ const t=this.db.transaction(store,mode), s=t.objectStore(store); const r=fn(s); t.oncomplete=()=>res(r&&r.result); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error||Error('abort')); }catch(e){rej(e);} }); },
    lsGet(){ try{return JSON.parse(localStorage.getItem(DB)||'{"writers":{},"recs":[]}');}catch(e){return {writers:{},recs:[]};} },
    lsSet(o){ localStorage.setItem(DB,JSON.stringify(o)); },
    async all(){ if(await this.open()){ const recs=await this.tx('recs','readonly',s=>s.getAll()), ws=await this.tx('writers','readonly',s=>s.getAll()); const writers={}; (ws||[]).forEach(w=>writers[w.id]=w); return {writers,recs:recs||[]}; } return this.lsGet(); },
    async put(rec){ if(await this.open()) return this.tx('recs','readwrite',s=>s.put(rec)); const o=this.lsGet(); o.recs=o.recs.filter(r=>r.key!==rec.key).concat(rec); this.lsSet(o); },
    async setWriter(w){ if(await this.open()) return this.tx('writers','readwrite',s=>s.put(w)); const o=this.lsGet(); o.writers[w.id]=w; this.lsSet(o); },
    async clear(){ if(await this.open()){ await this.tx('recs','readwrite',s=>s.clear()); await this.tx('writers','readwrite',s=>s.clear()); } try{localStorage.removeItem(DB);}catch(e){} }
  };
})();
