import type { Focus, Group, Participant, Pressure, Step, StudyBackup } from '../shared/schema';
export const PROTOCOL_VERSION = 'HF-EF-v2-web-draft-1';
export const QUESTION_VERSION = 'ko-ppt-draft-1';
export const PRESSURE_LABEL: Record<Pressure, string> = { low: '저압박', high: '고압박' };
export const FOCUS_LABEL: Record<Focus, string> = { HF: '전체적 주의초점', EF: '외적 주의초점' };
export const GROUPS: Record<Group, { pressure: Pressure; focus: Focus[] }[]> = {
  A: [{ pressure: 'low', focus: ['HF', 'EF'] }, { pressure: 'high', focus: ['EF', 'HF'] }],
  B: [{ pressure: 'low', focus: ['EF', 'HF'] }, { pressure: 'high', focus: ['HF', 'EF'] }],
  C: [{ pressure: 'high', focus: ['HF', 'EF'] }, { pressure: 'low', focus: ['EF', 'HF'] }],
  D: [{ pressure: 'high', focus: ['EF', 'HF'] }, { pressure: 'low', focus: ['HF', 'EF'] }],
};
export const CUES = {
  HF: { instruction: '점프 전 과정을 하나의 빠르고 폭발적인 흐름으로 느끼며 뛰세요.', cue: '폭발적으로' },
  EF: { instruction: '앞쪽의 주황색 콘 방향으로 최대한 멀리 나아가는 효과에 집중하며 뛰세요.', cue: '콘 쪽을 향해' },
};
export interface Question { key: string; title: string; low: string; high: string; min: number; max: number; type: 'scale' | 'vas' }
export const MRF_QUESTIONS: Question[] = [
  { key: 'cognitive_anxiety', title: '지금 마음의 상태는 어떻습니까?', low: '평온함', high: '걱정됨', min: 1, max: 11, type: 'scale' },
  { key: 'somatic_anxiety', title: '지금 몸의 상태는 어떻습니까?', low: '이완됨', high: '긴장됨', min: 1, max: 11, type: 'scale' },
  { key: 'self_confidence', title: '지금 점프를 수행하는 데 얼마나 자신이 있습니까?', low: '두려움 / 자신 없음', high: '자신 있음', min: 1, max: 11, type: 'scale' },
];
export const PRESSURE_QUESTION: Question = {
  key: 'evaluation_pressure', title: '방금 수행에서 나는 평가받고 있다는 압박을 강하게 느꼈다.',
  low: '전혀 그렇지 않다', high: '매우 그렇다', min: 1, max: 7, type: 'scale',
};
export function focusQuestions(focus: Focus): Question[] {
  return [
    { key: 'focus_adherence', title: focus === 'HF' ? '방금 두 번의 점프에서 움직임 전체의 흐름과 느낌에 얼마나 집중했습니까?' : '방금 두 번의 점프에서 목표물과 그 방향으로 나아가는 움직임의 효과에 얼마나 집중했습니까?', low: '전혀 집중하지 않음', high: '완전히 집중함', min: 0, max: 100, type: 'vas' },
    { key: 'internal_focus', title: '방금 두 번의 점프에서 신체 부위의 움직임에 얼마나 집중했습니까?', low: '전혀 집중하지 않음', high: '완전히 집중함', min: 0, max: 100, type: 'vas' },
  ];
}
export function buildSteps(group: Group): Step[] {
  const steps: Step[] = [
    { id: 'prep', kind: 'prep', label: '워밍업·지시 이해 확인', visit: 0 },
    { id: 'baseline-1', kind: 'baseline', label: '무지시 사전기록 1회', visit: 0, trial: 1 },
    { id: 'baseline-2', kind: 'baseline', label: '무지시 사전기록 2회', visit: 0, trial: 2 },
  ];
  GROUPS[group].forEach((s, i) => {
    const visit = i + 1;
    const base = { visit, pressure: s.pressure };
    if (visit === 2) steps.push({ ...base, id: 'interval', kind: 'interval', label: '방문 간격·재개 확인' });
    steps.push({ ...base, id: `v${visit}-intro`, kind: 'intro', label: '압박조건 안내' });
    steps.push({ ...base, id: `v${visit}-mrf`, kind: 'mrf', label: '수행 전 MRF-3' });
    s.focus.forEach((focus, j) => {
      const block = j + 1;
      const b = { ...base, focus, block };
      if (j === 1) steps.push({ ...base, id: `v${visit}-rest`, kind: 'rest', label: '블록 간 휴식 · 10분' });
      steps.push({ ...b, id: `v${visit}-b${block}-cue`, kind: 'cue', label: `${focus} 지시·공통 루틴` });
      for (let trial = 1; trial <= 2; trial++) steps.push({ ...b, id: `v${visit}-b${block}-t${trial}`, kind: 'jump', label: `${focus} 점프 ${trial}회`, trial });
      steps.push({ ...b, id: `v${visit}-b${block}-focus`, kind: 'focus', label: `${focus} 주의초점 집중도` });
    });
    steps.push({ ...base, id: `v${visit}-pressure`, kind: 'pressure', label: '평가압박 지각' });
    steps.push({ ...base, id: `v${visit}-end`, kind: 'visitEnd', label: `${visit}차 세션 종료·백업` });
  });
  steps.push({ id: 'complete', kind: 'complete', label: '실험 완료', visit: 2 });
  return steps;
}
export function summarize(p: Participant) {
  const by = (pressure?: Pressure, focus?: Focus) => {
    const rows = p.responses.filter(r => (pressure ? r.kind === 'jump' && r.pressure === pressure && r.focus === focus : r.kind === 'baseline'));
    const valid = rows.filter(r => r.values.validity === 'valid' && typeof r.values.distance === 'number').map(r => r.values.distance as number);
    return { best: valid.length ? Math.max(...valid) : null, mean: valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 100) / 100 : null, validN: valid.length, recordedN: rows.length };
  };
  const lowHF = by('low', 'HF'), lowEF = by('low', 'EF'), highHF = by('high', 'HF'), highEF = by('high', 'EF');
  return { baseline: by(), lowHF, lowEF, highHF, highEF, highDifference: highHF.best !== null && highEF.best !== null ? Math.round((highHF.best - highEF.best) * 100) / 100 : null };
}
export function validateBackup(raw: unknown): StudyBackup {
  const data = raw as StudyBackup;
  if (!data || data.schemaVersion !== 1 || data.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(data.participants) || data.participants.length > 500) throw new Error('이 앱과 호환되는 JSON 백업이 아닙니다.');
  const ids = new Set<string>(), codes = new Set<string>();
  for (const p of data.participants) {
    if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(p.id) || typeof p.code !== 'string' || !/^[a-zA-Z0-9_-]{1,30}$/.test(p.code) || !Object.hasOwn(GROUPS, p.group) || !Array.isArray(p.responses) || !['active', 'completed', 'withdrawn'].includes(p.status) || typeof p.isDemo !== 'boolean' || typeof p.researcher !== 'string' || p.researcher.length > 60 || typeof p.notes !== 'string' || p.notes.length > 2000 || typeof p.consentConfirmed !== 'boolean' || typeof p.eligibilityConfirmed !== 'boolean' || typeof p.protocolReviewed !== 'boolean' || !Number.isFinite(Date.parse(p.createdAt))) throw new Error('참여자 형식이 올바르지 않습니다.');
    if (ids.has(p.id) || codes.has(`${p.isDemo}:${p.code}`)) throw new Error('백업에 중복 참여자가 있습니다.');
    ids.add(p.id); codes.add(`${p.isDemo}:${p.code}`);
    const steps = buildSteps(p.group);
    if (!Number.isInteger(p.stepIndex) || p.stepIndex < 0 || p.stepIndex >= steps.length || p.responses.length !== p.stepIndex) throw new Error('실험 진행 순서가 일치하지 않습니다.');
    if (p.status === 'completed' && steps[p.stepIndex].kind !== 'complete') throw new Error('완료 상태가 일치하지 않습니다.');
    for (let i = 0; i < p.responses.length; i++) {
      const r = p.responses[i], s = steps[i];
      if (r.stepId !== s.id || r.kind !== s.kind || r.visit !== s.visit || r.focus !== s.focus || r.pressure !== s.pressure || r.block !== s.block || r.trial !== s.trial || !r.values || typeof r.values !== 'object' || !Number.isFinite(Date.parse(r.startedAt)) || !Number.isFinite(Date.parse(r.completedAt))) throw new Error('응답 시점 또는 순서 정보가 손상되었습니다.');
      if (r.missingReason && (typeof r.missingReason !== 'string' || !r.missingReason.trim())) throw new Error('결측 사유가 올바르지 않습니다.');
      if (s.kind === 'jump' || s.kind === 'baseline') {
        if (!['valid', 'foul', 'missing'].includes(String(r.values.validity))) throw new Error('시행 상태가 올바르지 않습니다.');
        if (r.values.validity === 'valid' && (typeof r.values.distance !== 'number' || !Number.isFinite(r.values.distance) || r.values.distance <= 0 || r.values.distance > 500)) throw new Error('점프 기록 범위가 올바르지 않습니다.');
        if (r.values.validity !== 'valid' && (r.values.distance !== null || typeof r.values.reason !== 'string' || !r.values.reason.trim())) throw new Error('무효/결측 시행의 사유를 확인하세요.');
      }
      const questions = s.kind === 'mrf' ? MRF_QUESTIONS : s.kind === 'focus' ? focusQuestions(s.focus!) : s.kind === 'pressure' ? [PRESSURE_QUESTION] : [];
      for (const q of questions) {
        const v = r.values[q.key];
        if (v === null && r.missingReason) continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < q.min || v > q.max || !Number.isInteger(v)) throw new Error('설문 응답 범위가 올바르지 않습니다.');
      }
    }
  }
  return data;
}
