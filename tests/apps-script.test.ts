import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { buildSteps, PROTOCOL_VERSION, QUESTION_VERSION, summarize } from '../src/protocol.ts';
import type { Group, Participant, Response, SyncEnvelope, SyncReceipt } from '../shared/schema.ts';

const script = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const SECRET = 'test-only-collection-code-32-characters';
type Cell = string | number | boolean | null;
type RecordRow = Record<string, Cell>;

function mockCollector(consumeApostrophe = false) {
  const sheets = new Map<string, MockSheet>();
  const properties = new Map<string, string>([['COLLECTION_CODE', SECRET]]);
  const state = { writes: 0, flushes: 0, reads: 0, releases: 0, failWriteAt: -1, failFlush: false, busy: false };
  class MockSheet {
    rows: Cell[][] = [];
    gridRows = 1000;
    gridColumns = 26;
    getLastRow() { return this.rows.length; }
    getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
    getMaxRows() { return this.gridRows; }
    getMaxColumns() { return this.gridColumns; }
    insertRowsAfter(_after: number, count: number) { this.gridRows += count; }
    insertColumnsAfter(_after: number, count: number) { this.gridColumns += count; }
    setFrozenRows() {}
    getRange(row: number, col: number, height: number, width: number) {
      assert.ok(row + height - 1 <= this.gridRows && col + width - 1 <= this.gridColumns, 'range must fit the sheet grid');
      const range = {
        setNumberFormat: (_format: string) => range,
        getValues: () => Array.from({ length: height }, (_, i) =>
          Array.from({ length: width }, (_, j) => this.rows[row - 1 + i]?.[col - 1 + j] ?? '')),
        setValues: (values: Cell[][]) => {
          state.writes++;
          if (state.writes === state.failWriteAt) throw new Error('simulated write failure');
          assert.equal(values.length, height);
          values.forEach((valuesRow, i) => {
            assert.equal(valuesRow.length, width);
            const target = this.rows[row - 1 + i] ??= [];
            valuesRow.forEach((v, j) => {
              target[col - 1 + j] = consumeApostrophe && typeof v === 'string'
                ? v.replace(/^'(?=[=+\-@\t\r])/, '') : v;
            });
          });
          return range;
        }
      };
      return range;
    }
  }
  const spreadsheet = {
    getId: () => 'mock-spreadsheet-id',
    getSheetByName: (name: string) => sheets.get(name),
    insertSheet: (name: string) => { const sheet = new MockSheet(); sheets.set(name, sheet); return sheet; }
  };
  const context = vm.createContext({
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => properties.get(key) ?? null,
        setProperty: (key: string, value: string) => properties.set(key, value)
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: (id: string) => {
        state.reads++; assert.equal(id, 'mock-spreadsheet-id'); return spreadsheet;
      },
      flush: () => { state.flushes++; if (state.failFlush) throw new Error('simulated flush failure'); }
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {},
        tryLock: () => !state.busy,
        releaseLock: () => { state.releases++; }
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      newBlob: (text: string) => ({ getBytes: () => Array.from(Buffer.from(text, 'utf8')) }),
      computeDigest: (_algorithm: string, value: string) => Array.from(createHash('sha256').update(value).digest())
    }
  });
  vm.runInContext(script, context, { filename: 'Code.gs' });
  function call(name: string, value?: unknown): any { // Apps Script's dynamic host API is isolated here.
    context.input = value;
    return vm.runInContext(`${name}(input)`, context);
  }
  call('setup');
  function post(envelope: unknown, type = 'text/plain;charset=UTF-8'): SyncReceipt {
    return JSON.parse(call('doPost', { postData: { contents: JSON.stringify(envelope), type } }).text);
  }
  function data(name: string): RecordRow[] {
    const rows = sheets.get(name)!.rows;
    return rows.slice(1).map(row => Object.fromEntries(rows[0].map((h, i) => [h, row[i]])));
  }
  return { call, post, data, sheets, properties, state, context };
}

function utc(minutes: number) {
  return new Date(Date.UTC(2026, 0, 1) + minutes * 60_000).toISOString();
}
function participant(group: Group = 'A', count = buildSteps(group).length - 1): Participant {
  const responses: Response[] = buildSteps(group).slice(0, count).map((s, i) => {
    const { label: _label, id, ...metadata } = s;
    let values: Record<string, unknown> = {};
    if (s.kind === 'prep') values = { warmup: true, hf_teachback: true, ef_teachback: true };
    if (s.kind === 'intro') values = { pressure_setup_confirmed: true };
    if (s.kind === 'cue') values = { cue: s.focus === 'HF' ? '폭발적으로' : '콘 쪽을 향해', instruction_confirmed: true };
    if (s.kind === 'visitEnd') values = { backup_confirmed: true };
    if (s.kind === 'rest')
      values = { rest_seconds: 0, planned_seconds: 600, timer_started_at: null, protocol_deviation: true, deviation_reason: '합성 테스트' };
    if (s.kind === 'interval')
      values = { elapsed_hours: 0.02, minimum_hours: 48, protocol_deviation: true, deviation_reason: '합성 테스트', eligibility_reconfirmed: true };
    if (s.kind === 'baseline' || s.kind === 'jump')
      values = { distance: s.kind === 'baseline' ? 200 + s.trial! : (s.focus === 'HF' ? 230 : 220) + s.trial!, validity: 'valid', reason: '', unit: 'cm' };
    if (s.kind === 'mrf') values = { cognitive_anxiety: 1, somatic_anxiety: 11, self_confidence: 9 };
    if (s.kind === 'focus') values = { focus_adherence: 100, internal_focus: 0 };
    if (s.kind === 'pressure') values = { evaluation_pressure: 7 };
    if (['mrf', 'focus', 'pressure'].includes(s.kind)) {
      const keys = Object.keys(values);
      Object.assign(values, {
        question_version: QUESTION_VERSION,
        response_time_ms: 60_000,
        response_methods: Object.fromEntries(keys.map(k => [k, s.kind === 'focus' ? 'range' : 'radio'])),
        item_timestamps: Object.fromEntries(keys.map(k => [k, { answeredAt: utc(i * 2 + 2) }]))
      });
    }
    return { ...metadata, stepId: id, startedAt: utc(i * 2 + 1), completedAt: utc(i * 2 + 2), values };
  });
  return {
    id: 'participant-001', code: 'P001', group, isDemo: false, researcher: 'R01',
    createdAt: utc(0), consentConfirmed: true, eligibilityConfirmed: true,
    protocolReviewed: true, stepIndex: count,
    status: count === buildSteps(group).length - 1 ? 'completed' : 'active',
    responses, notes: ''
  };
}
function envelope(p = participant()): SyncEnvelope {
  return {
    schemaVersion: 1, protocolVersion: PROTOCOL_VERSION,
    submissionId: 'submission-001', sentAt: utc(1000), collectionCode: SECRET, participant: p
  };
}
function expectRejected(mutate: (e: SyncEnvelope) => void, expected?: string) {
  const c = mockCollector(), e = envelope(), initialWrites = c.state.writes;
  mutate(e);
  const result = c.post(e);
  assert.equal(result.ok, false);
  if (expected) assert.equal(result.error, expected);
  assert.equal(c.state.writes, initialWrites, 'validation must happen before writes');
  assert.ok(!JSON.stringify(result).includes(SECRET));
}

test('step mirrors exactly match the shared protocol for A–D, including 10 jumps', () => {
  const c = mockCollector();
  for (const group of ['A', 'B', 'C', 'D'] as const) {
    const expected = buildSteps(group).map(({ label: _label, ...rest }) => rest);
    assert.deepEqual(JSON.parse(JSON.stringify(c.call('buildSteps_', group))), expected);
    assert.equal(expected.filter(s => ['baseline', 'jump'].includes(s.kind)).length, 10);
  }
  assert.equal(c.call('doGet').text.includes(PROTOCOL_VERSION), true);
  assert.equal(c.context.FJL.questionVersion, QUESTION_VERSION);
});

test('setup is repeatable and health exposes no data or secret', () => {
  const c = mockCollector();
  c.post(envelope());
  const counts = [...c.sheets.values()].map(s => s.rows.length);
  c.call('setup');
  assert.deepEqual([...c.sheets.values()].map(s => s.rows.length), counts);
  assert.equal(c.properties.get('COLLECTION_CODE'), SECRET);
  const reads = c.state.reads, health = JSON.parse(c.call('doGet').text);
  assert.deepEqual(health, { ok: true, service: 'focus-jump-lab', protocolVersion: PROTOCOL_VERSION });
  assert.equal(c.state.reads, reads);
});

test('setup expands the default 26-column grid and writes grow a full row grid', () => {
  const c = mockCollector();
  assert.ok(c.sheets.get('Participants')!.getMaxColumns() > 26);
  c.sheets.get('Responses')!.gridRows = 2;
  assert.equal(c.post(envelope()).ok, true);
  assert.equal(c.sheets.get('Responses')!.getMaxRows(), 31);
});

test('all groups write long rows, trial rows and matching derived summaries', () => {
  for (const group of ['A', 'B', 'C', 'D'] as const) {
    const c = mockCollector(), e = envelope(participant(group)), summary = summarize(e.participant);
    const result = c.post(e);
    assert.equal(result.ok, true);
    assert.equal(result.submissionId, e.submissionId);
    assert.ok(result.receivedAt);
    assert.equal(c.data('Responses').length, e.participant.responses.length);
    assert.equal(c.data('Trials').length, 10);
    assert.equal(c.data('Conditions').length, 5);
    const p = c.data('Participants')[0];
    assert.equal(p.question_version, QUESTION_VERSION);
    assert.equal(p.high_difference_cm, summary.highDifference);
    for (const condition of ['baseline', 'lowHF', 'lowEF', 'highHF', 'highEF'] as const) {
      const row = c.data('Conditions').find(r => r.condition === condition)!;
      assert.equal(row.max_cm, summary[condition].best);
      assert.equal(row.mean_cm, summary[condition].mean);
      assert.equal(row.valid_n, 2);
    }
    assert.equal(c.data('Responses').find(r => r.kind === 'mrf')!.self_confidence, 9);
    assert.equal(c.state.flushes, 2, 'setup and successful commit both flush');
  }
});

test('identical and new-submission retries do not duplicate immutable rows', () => {
  const c = mockCollector(), e = envelope();
  assert.equal(c.post(e).ok, true);
  const before = structuredClone(c.data('Responses'));
  assert.equal(c.post(e).ok, true);
  e.submissionId = 'submission-002'; e.sentAt = utc(1001); e.participant.notes = '후속 연구 메모';
  assert.equal(c.post(e).ok, true);
  assert.deepEqual(c.data('Responses'), before);
  assert.equal(c.data('Participants').length, 1);
  assert.equal(c.data('Participants')[0].notes, '후속 연구 메모');
  assert.equal(c.data('Trials').length, 10);
});

test('each partial-write boundary and flush failure can be repaired by the identical retry', () => {
  const probe = mockCollector(), e = envelope(), before = probe.state.writes;
  assert.equal(probe.post(e).ok, true);
  const writesPerCommit = probe.state.writes - before;
  for (let boundary = 1; boundary <= writesPerCommit; boundary++) {
    const c = mockCollector();
    c.state.failWriteAt = c.state.writes + boundary;
    assert.equal(c.post(e).ok, false, `failure boundary ${boundary}`);
    c.state.failWriteAt = -1;
    assert.equal(c.post(e).ok, true, `retry boundary ${boundary}`);
    assert.equal(c.data('Participants').length, 1);
    assert.equal(c.data('Responses').length, e.participant.responses.length);
    assert.equal(c.data('Trials').length, 10);
    assert.equal(c.data('Conditions').length, 5);
  }
  const c = mockCollector();
  c.state.failFlush = true;
  assert.equal(c.post(e).ok, false, 'flush failure must not ACK');
  c.state.failFlush = false;
  assert.equal(c.post(e).ok, true);
  assert.equal(c.data('Participants').length, 1);
});

test('historic conflict is rejected before any write and cannot overwrite values', () => {
  const c = mockCollector(), e = envelope();
  c.post(e);
  const count = c.state.writes;
  e.participant.responses[1].values.distance = 499;
  assert.equal(c.post(e).error, 'RESPONSE_CONFLICT');
  assert.equal(c.state.writes, count);
  assert.equal(c.data('Trials')[0].distance_cm, 201);
});

test('partial history still protects immutable participant identity', () => {
  const c = mockCollector(), e = envelope();
  c.state.failWriteAt = c.state.writes + 3;
  assert.equal(c.post(e).ok, false);
  assert.equal(c.data('Participants').length, 0);
  c.state.failWriteAt = -1;
  e.participant.createdAt = utc(-1);
  assert.equal(c.post(e).error, 'PARTICIPANT_CONFLICT');
});

test('old snapshots never reduce completed progress or condition aggregates', () => {
  const c = mockCollector(), old = envelope(participant('A', 3)), current = envelope();
  old.sentAt = utc(999);
  assert.equal(c.post(current).ok, true);
  assert.equal(c.post(old).ok, true);
  assert.equal(c.data('Participants')[0].status, 'completed');
  assert.equal(c.data('Participants')[0].step_index, current.participant.stepIndex);
  assert.equal(c.data('Participants')[0].high_difference_cm, 10);
  assert.equal(c.data('Responses').length, current.participant.responses.length);
});

test('terminal participants cannot be silently reopened', () => {
  const c = mockCollector(), e = envelope();
  c.post(e);
  e.participant.status = 'active'; e.sentAt = utc(1001);
  assert.equal(c.post(e).error, 'STATUS_CONFLICT');
});

test('invalid requests never write or leak secrets', () => {
  expectRejected(e => { e.schemaVersion = 2 as 1; }, 'SCHEMA_VERSION');
  expectRejected(e => { e.protocolVersion = 'other'; }, 'PROTOCOL_VERSION');
  expectRejected(e => { e.collectionCode = 'wrong'; }, 'UNAUTHORIZED');
  expectRejected(e => { e.participant.isDemo = true; }, 'DEMO_REJECTED');
  expectRejected(e => { e.participant.consentConfirmed = false; }, 'CONSENT_REQUIRED');
  expectRejected(e => { e.participant.eligibilityConfirmed = false; }, 'CONSENT_REQUIRED');
  expectRejected(e => { e.participant.protocolReviewed = false; }, 'CONSENT_REQUIRED');
  expectRejected(e => { e.submissionId = '=bad'; }, 'INVALID_SUBMISSION');
  expectRejected(e => { e.participant.id = '../bad'; }, 'INVALID_PARTICIPANT_ID');
  expectRejected(e => { e.participant.code = '@bad'; }, 'INVALID_PARTICIPANT_ID');
  expectRejected(e => { e.participant.group = 'toString' as Group; }, 'INVALID_GROUP');
  expectRejected(e => { e.participant.stepIndex--; }, 'STEP_INDEX');
  expectRejected(e => { e.participant.responses[1].trial = 2; }, 'RESPONSE_ORDER');
  expectRejected(e => { e.participant.responses.reverse(); }, 'RESPONSE_ORDER');
  expectRejected(e => { e.participant.responses[0].completedAt = utc(-1); }, 'RESPONSE_TIME');
  expectRejected(e => { e.participant.createdAt = '2026-02-30T00:00:00.000Z'; }, 'INVALID_PARTICIPANT');
  expectRejected(e => { e.sentAt = utc(1); }, 'RESPONSE_TIME');
  expectRejected(e => { e.participant.responses[0].startedAt = 'invalid'; }, 'RESPONSE_TIME');
  expectRejected(e => { (e.participant as any).age = 21; }, 'INVALID_SHAPE');
  expectRejected(e => { e.participant.notes = 'x'.repeat(2001); }, 'INVALID_PARTICIPANT');
});

test('score boundaries, missing reasons, and finite distance constraints', () => {
  for (const distance of [0, -1, 501, Infinity, NaN, '230'])
    expectRejected(e => { e.participant.responses[1].values.distance = distance; }, 'TRIAL_DISTANCE');
  for (const value of [0, 12, 1.5, null, '3'])
    expectRejected(e => { e.participant.responses.find(r => r.kind === 'mrf')!.values.cognitive_anxiety = value; }, 'SCORE_RANGE');
  expectRejected(e => { e.participant.responses.find(r => r.kind === 'pressure')!.values.evaluation_pressure = 8; }, 'SCORE_RANGE');
  expectRejected(e => { e.participant.responses.find(r => r.kind === 'focus')!.values.focus_adherence = 101; }, 'SCORE_RANGE');
  expectRejected(e => { e.participant.responses[1].values = { distance: null, validity: 'foul', reason: ' ' }; }, 'TRIAL_REASON');
  expectRejected(e => { e.participant.responses[1].values = { distance: 210, validity: 'missing', reason: '중단' }; }, 'TRIAL_REASON');
  const c = mockCollector(), e = envelope();
  e.participant.responses[1].values = { distance: null, validity: 'foul', reason: '발 구름선 침범' };
  e.participant.responses[2].values = { distance: null, validity: 'missing', reason: '통증으로 중단' };
  const mrf = e.participant.responses.find(r => r.kind === 'mrf')!;
  mrf.values.cognitive_anxiety = null; mrf.missingReason = '응답 거부';
  assert.equal(c.post(e).ok, true);
  const baseline = c.data('Conditions').find(r => r.condition === 'baseline')!;
  assert.equal(baseline.max_cm, '');
  assert.equal(baseline.valid_n, 0);
  assert.equal(baseline.recorded_n, 2);
});

test('current frontend metadata and procedural confirmations are validated', () => {
  expectRejected(e => { e.participant.responses[1].values.unit = 'm'; }, 'TRIAL_UNIT');
  expectRejected(e => { e.participant.responses.find(r => r.kind === 'mrf')!.values.question_version = 'unknown'; }, 'QUESTION_VERSION');
  expectRejected(e => { e.participant.responses.find(r => r.kind === 'mrf')!.values.response_time_ms = -1; }, 'RESPONSE_TIME');
  expectRejected(e => { e.participant.responses.find(r => r.kind === 'focus')!.values.response_methods = { focus_adherence: 'bad' }; }, 'RESPONSE_METHOD');
  expectRejected(e => { e.participant.responses.find(r => r.kind === 'mrf')!.values.item_timestamps = { cognitive_anxiety: { answeredAt: utc(-1) } }; }, 'RESPONSE_TIME');
  expectRejected(e => { e.participant.responses[0].values.hf_teachback = false; }, 'PROCEDURE_CONFIRMATION');
  expectRejected(e => { e.participant.responses[0].values.age = 21; }, 'INVALID_SHAPE');
  expectRejected(e => { e.participant.responses.find(r => r.kind === 'rest')!.values.deviation_reason = ''; }, 'DEVIATION_REASON');
  expectRejected(e => { e.participant.responses.find(r => r.kind === 'rest')!.values.protocol_deviation = false; }, 'REST_VALUES');
  expectRejected(e => { e.participant.responses.find(r => r.kind === 'interval')!.values.protocol_deviation = false; }, 'INTERVAL_VALUES');
});

test('formula-like free text and JSON are stored as inert text', () => {
  for (const consume of [false, true]) {
    for (const prefix of ['=', '+', '-', '@', '\t', '\r']) {
      const c = mockCollector(consume), e = envelope();
      e.participant.id = '-participant';
      e.participant.code = '-P001';
      e.participant.researcher = prefix + 'INJECTION';
      e.participant.notes = prefix + 'INJECTION';
      e.participant.responses[1].values.reason = prefix + 'INJECTION';
      assert.equal(c.post(e).ok, true);
      assert.equal(c.post(e).ok, true, 'escaped identifiers must retain stable lookup');
      assert.equal(c.data('Participants').length, 1);
      assert.equal(c.data('Trials').length, 10);
      const p = c.data('Participants')[0];
      assert.equal(p.notes, (consume ? '' : "'") + prefix + 'INJECTION');
      const r = c.data('Responses').find(row => row.step_id === 'baseline-1')!;
      assert.equal(JSON.parse(String(r.values_json)).reason, prefix + 'INJECTION');
      assert.ok(String(r.values_json).startsWith('{'));
    }
  }
});

test('body bounds, JSON, content type, configuration, lock and headers fail safely', () => {
  const c = mockCollector(), initial = c.state.writes;
  const raw = (body: string) => JSON.parse(c.call('doPost', { postData: { contents: body, type: 'text/plain' } }).text);
  assert.equal(raw('{broken').error, 'INVALID_JSON');
  assert.equal(raw('x'.repeat(131073)).error, 'BODY_TOO_LARGE');
  assert.equal(raw('가'.repeat(50000)).error, 'BODY_TOO_LARGE');
  assert.equal(c.post(envelope(), 'application/json').error, 'CONTENT_TYPE');
  c.state.busy = true;
  assert.equal(c.post(envelope()).error, 'BUSY_RETRY');
  c.state.busy = false;
  c.properties.delete('COLLECTION_CODE');
  assert.equal(c.post(envelope()).error, 'NOT_CONFIGURED');
  c.properties.set('COLLECTION_CODE', SECRET);
  c.sheets.get('Trials')!.rows[0][0] = 'changed_header';
  assert.equal(c.post(envelope()).error, 'SHEET_HEADERS');
  assert.equal(c.state.writes, initial);
});
