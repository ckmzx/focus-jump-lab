import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSteps, GROUPS, summarize, validateBackup, PROTOCOL_VERSION, MRF_QUESTIONS, focusQuestions, PRESSURE_QUESTION } from '../src/protocol.ts';
import { csvCell, exportRows } from '../src/data.ts';
import type { Group, Participant, Response } from '../shared/schema.ts';

export function fixture(group: Group = 'A'): Participant {
  const p: Participant = { id: '12345-test', code: 'P001', group, isDemo: false, researcher: 'R01', createdAt: '2026-01-01T00:00:00.000Z', consentConfirmed: true, eligibilityConfirmed: true, protocolReviewed: true, stepIndex: 0, status: 'active', responses: [], notes: '' };
  return p;
}
for (const group of ['A', 'B', 'C', 'D'] as Group[]) {
  test(`${group}군 순서와 설문 횟수가 PPT와 일치`, () => {
    const steps = buildSteps(group);
    assert.equal(steps.filter(s => s.kind === 'baseline').length, 2);
    assert.equal(steps.filter(s => s.kind === 'jump').length, 8);
    assert.equal(steps.filter(s => s.kind === 'mrf').length, 2);
    assert.equal(steps.filter(s => s.kind === 'focus').length, 4);
    assert.equal(steps.filter(s => s.kind === 'pressure').length, 2);
    assert.equal(steps.filter(s => s.kind === 'rest').length, 2);
    assert.equal(new Set(steps.map(s => s.id)).size, steps.length);
    for (const visit of [1, 2]) {
      const b = steps.filter(s => s.visit === visit);
      assert.ok(b.findIndex(s => s.kind === 'intro') < b.findIndex(s => s.kind === 'mrf'));
      assert.ok(b.findIndex(s => s.kind === 'mrf') < b.findIndex(s => s.kind === 'jump'));
      assert.deepEqual(b.filter(s => s.kind === 'cue').map(s => s.focus), GROUPS[group][visit - 1].focus);
      assert.ok(b.findIndex(s => s.kind === 'pressure') > b.map(s => s.kind).lastIndexOf('focus'));
      assert.equal(b.filter(s => s.kind === 'mrf')[0].pressure, GROUPS[group][visit - 1].pressure);
    }
  });
}
test('척도 방향 및 문항 수', () => {
  assert.equal(MRF_QUESTIONS.length * 2 + focusQuestions('HF').length * 4 + 2, 16);
  assert.equal(MRF_QUESTIONS[2].high, '자신 있음');
  assert.equal(PRESSURE_QUESTION.max, 7);
  assert.equal(focusQuestions('EF')[1].key, 'internal_focus');
});
test('최고 평균 차이 및 결측 처리', () => {
  const p = fixture();
  const make = (distance: number | null, validity: string, focus: 'HF' | 'EF', trial: number): Response => ({ stepId: `${focus}-${trial}`, kind: 'jump', visit: 2, pressure: 'high', focus, trial, block: focus === 'HF' ? 2 : 1, startedAt: p.createdAt, completedAt: p.createdAt, values: { distance, validity } });
  p.responses = [make(250, 'valid', 'HF', 1), make(254, 'valid', 'HF', 2), make(252, 'valid', 'EF', 1), make(null, 'foul', 'EF', 2)];
  const s = summarize(p);
  assert.equal(s.highHF.best, 254); assert.equal(s.highHF.mean, 252);
  assert.equal(s.highDifference, 2); assert.equal(s.highEF.validN, 1);
  assert.equal(s.lowHF.best, null);
  assert.equal(exportRows([p], 'conditions').length, 5);
});
test('CSV 수식 인젝션 방지', () => {
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell(-3), '"-3"');
  assert.equal(csvCell('a"b'), '"a""b"');
});
test('올바른 빈 참여자 백업과 프로토콜 버전 확인', () => {
  const data = { schemaVersion: 1, protocolVersion: PROTOCOL_VERSION, exportedAt: new Date().toISOString(), participants: [fixture()] };
  assert.equal(validateBackup(data).participants.length, 1);
  assert.throws(() => validateBackup({ ...data, protocolVersion: 'unknown' }));
  assert.throws(() => validateBackup({ ...data, participants: [fixture(), fixture()] }));
  assert.throws(() => validateBackup({ ...data, participants: [{ ...fixture(), group: '__proto__' }] }));
});
test('손상된 순서와 허용 범위 밖 기록 거부', () => {
  const p = fixture(); p.stepIndex = 1;
  const data = { schemaVersion: 1, protocolVersion: PROTOCOL_VERSION, participants: [p] };
  assert.throws(() => validateBackup(data));
  p.responses.push({ stepId: 'prep', kind: 'prep', visit: 0, startedAt: p.createdAt, completedAt: p.createdAt, values: {} });
  assert.equal(validateBackup(data).participants.length, 1);
  p.stepIndex = 2; p.responses.push({ stepId: 'baseline-1', kind: 'baseline', visit: 0, trial: 1, startedAt: p.createdAt, completedAt: p.createdAt, values: { distance: 999, validity: 'valid', reason: '' } });
  assert.throws(() => validateBackup(data));
  p.responses[1].values.distance = 222.5;
  assert.equal(validateBackup(data).participants.length, 1);
});
