// B1 原生数据层：启动时的第一次 load 提前到 HTML 解析时发出（01 §4.1「启动加载」）。
// 经典脚本（不是模块），index.html 里紧跟样式表、在 deck-data.js 等脚本之前；只在 iOS 壳（shizi-resource: 协议）里发请求，
// 网页 / e2e 什么都不做。请求与 HTML 解析、deck-data.js 执行、模块下载并行；store/native-boot.js 在建 store 前取走
// window.__shiziNativeLoad（一次性），拿不到可用结果时自己再发一次 load。不碰 localStorage、不碰 DOM。
(function () {
  try {
    if (!window.location || window.location.protocol !== 'shizi-resource:') return;
    var xhr = new XMLHttpRequest();
    window.__shiziNativeLoad = new Promise(function (resolve) {
      var done = function (error) {
        resolve({ status: error ? 0 : xhr.status, text: error ? '' : xhr.responseText, error: error || null });
      };
      xhr.open('POST', '/__native/store/v1/load', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.timeout = 30000;
      xhr.onload = function () {
        done(null);
      };
      xhr.onerror = function () {
        done('error');
      };
      xhr.ontimeout = function () {
        done('timeout');
      };
      xhr.send('{}');
    });
  } catch (error) {
    // 发不出去：native-boot 自己再请求
  }
})();
