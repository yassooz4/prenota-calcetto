const {parentPort,workerData}=require('node:worker_threads');
const {mock}=require('./google_mock.cjs');
const m=mock({file:workerData.file,lockArray:new Int32Array(workerData.lockBuffer),now:workerData.now});
parentPort.postMessage(m.call(workerData.payload));
