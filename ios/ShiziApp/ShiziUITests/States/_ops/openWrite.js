// 打开写字页（网页路由；开关开着时是原生宿主）。a: {slot}
const { openWrite } = await import('/src/ui/screens/session/index.js');
openWrite(a.slot || 'B');
