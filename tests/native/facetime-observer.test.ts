import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFaceTimeObservation, runFaceTimeObserver } from '../../electron/features/call-help/facetime-observer';

const active = { accessibility: true, state: 'active', callId: '42:77', window: {x:-800,y:70,width:700,height:500}, timestamp: Date.now() };
test('FaceTime observation accepts safe call identity and negative display coordinates', () => {
  assert.deepEqual(parseFaceTimeObservation(active), active);
  const withVisibility = {...active, controlVisibility: {microphone:'covered',camera:'visible',end:'missing'}};
  assert.deepEqual(parseFaceTimeObservation(withVisibility),withVisibility);
  assert.equal(parseFaceTimeObservation({...active,callId:null}).state,'active');
  assert.equal(parseFaceTimeObservation({accessibility:false,state:'unknown',callId:null,window:null,timestamp:Date.now()}).state,'unknown');
});
test('FaceTime observation rejects false active claims, private fields and malformed geometry', () => {
  for (const value of [
    {...active,controlVisibility:{microphone:'visible',camera:'maybe',end:'missing'}},
    {...active,controlVisibility:{microphone:'visible',camera:'visible'}},
    {...active,controlVisibility:{microphone:'visible',camera:'visible',end:'missing',contact:'Private'}},
    {...active,accessibility:false}, {...active,window:null}, {...active,state:'inactive'},
    {...active,callId:'Contact name'}, {...active,contact:'Private'},
    {...active,window:{...active.window,width:-1}}, {...active,timestamp:NaN},
  ]) assert.throws(()=>parseFaceTimeObservation(value));
});
test('failed or aborted helper invocation never produces inactive evidence', async () => {
  await assert.rejects(runFaceTimeObserver('/does-not-exist/helpos-observer'),/could not check/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runFaceTimeObserver('/does-not-exist/helpos-observer',controller.signal),/could not check/);
});
test('native FaceTime classifier requires enabled call controls inside one real window', {skip:process.platform!=='darwin',timeout:45000}, () => {
  const directory=mkdtempSync(path.join(tmpdir(),'helpos-facetime-test-'));
  const binary=path.join(directory,'call-tests');
  try {
    execFileSync('swiftc',['-D','FACETIME_CALL_TEST','-module-cache-path','/private/tmp/helpos-swift-cache','native/Sources/AppContext.swift', 'native/Sources/Support.swift', 'native/Sources/ScreenObserver.swift', 'native/Sources/FaceTimeCallDetector.swift', 'native/Sources/Observation.swift', 'native/Sources/main.swift', 'native/Tests/FaceTimeCallTests.swift','-o',binary],{cwd:process.cwd(),timeout:35000,stdio:'pipe'});
    const output = execFileSync(binary,[],{encoding:'utf8',timeout:5000});
    assert.match(output,/27 FaceTime control and window identity checks passed/);
    assert.match(output,/61 FaceTime neutral switch checks passed/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
