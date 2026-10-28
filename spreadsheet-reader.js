(function(){
  'use strict';
  let active = null;
  window.readSpreadsheet = function(file, limits){
    if (active) active();
    return new Promise((resolve, reject) => {
      let worker, timer, finished = false;
      function finish(error, data){
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (worker) worker.terminate();
        if (active === cancel) active = null;
        error ? reject(new Error(error)) : resolve(data);
      }
      function cancel(){ finish('cancelled'); }
      active = cancel;
      try {
        worker = new Worker('spreadsheet-worker.js');
        timer = setTimeout(() => finish('timeout'), 20000);
        worker.onerror = () => finish('parse');
        worker.onmessage = ({ data }) => {
          if (!data || !Array.isArray(data.sheets)) finish(data?.error || 'parse');
          else finish(null, data.sheets);
        };
        worker.postMessage({ file, limits });
      } catch (e){ finish('parse'); }
    });
  };
})();
