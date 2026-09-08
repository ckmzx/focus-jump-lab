/**
 * Focus Jump Lab — write-only Google Sheets collector (V8 runtime).
 * Source contract: shared/schema.ts; step order: src/protocol.ts.
 * Never put a collection code, spreadsheet ID, or participant data in this file.
 * Run setup() in a spreadsheet-bound script, then configure Script Properties.
 */
var FJL = Object.freeze({
  schemaVersion: 1,
  protocolVersion: 'HF-EF-v2-web-draft-1',
  questionVersion: 'ko-ppt-draft-1',
  maxBodyBytes: 131072,
  maxRows: 50000,
  groups: {
    A: [{ pressure: 'low', focus: ['HF', 'EF'] }, { pressure: 'high', focus: ['EF', 'HF'] }],
    B: [{ pressure: 'low', focus: ['EF', 'HF'] }, { pressure: 'high', focus: ['HF', 'EF'] }],
    C: [{ pressure: 'high', focus: ['HF', 'EF'] }, { pressure: 'low', focus: ['EF', 'HF'] }],
    D: [{ pressure: 'high', focus: ['EF', 'HF'] }, { pressure: 'low', focus: ['HF', 'EF'] }]
  }
});

var HEADERS = {
  Participants: [
    'participant_id', 'participant_code', 'group', 'is_demo', 'researcher',
    'created_at_utc', 'consent_confirmed', 'eligibility_confirmed', 'protocol_reviewed',
    'protocol_version', 'question_version', 'session_order', 'focus_order',
    'step_index', 'status', 'response_count', 'started_at_utc', 'ended_at_utc', 'notes',
    'last_submission_id', 'last_sent_at_utc', 'received_at_utc',
    'baseline_max_cm', 'baseline_mean_cm', 'baseline_valid_n',
    'lowHF_max_cm', 'lowHF_mean_cm', 'lowHF_valid_n',
    'lowEF_max_cm', 'lowEF_mean_cm', 'lowEF_valid_n',
    'highHF_max_cm', 'highHF_mean_cm', 'highHF_valid_n',
    'highEF_max_cm', 'highEF_mean_cm', 'highEF_valid_n',
    'high_difference_cm', 'identity_hash'
  ],
  Responses: [
    'response_key', 'participant_id', 'participant_code', 'group',
    'protocol_version', 'question_version', 'session_order', 'focus_order',
    'step_index', 'step_id', 'kind', 'visit', 'pressure', 'focus', 'block', 'trial',
    'started_at_utc', 'ended_at_utc',
    'cognitive_anxiety', 'somatic_anxiety', 'self_confidence',
    'focus_adherence', 'internal_focus', 'evaluation_pressure',
    'distance_cm', 'validity', 'reason', 'missing_reason', 'values_json', 'response_hash', 'identity_hash'
  ],
  Trials: [
    'trial_key', 'participant_id', 'participant_code', 'group',
    'protocol_version', 'question_version', 'session_order', 'focus_order',
    'step_index', 'step_id', 'kind', 'visit', 'pressure', 'focus', 'block', 'trial',
    'started_at_utc', 'ended_at_utc', 'distance_cm', 'validity', 'reason', 'response_hash', 'identity_hash'
  ],
  Conditions: [
    'condition_key', 'participant_id', 'participant_code', 'group',
    'protocol_version', 'question_version', 'session_order', 'focus_order',
    'condition', 'visit', 'pressure', 'focus', 'block',
    'max_cm', 'mean_cm', 'valid_n', 'recorded_n', 'started_at_utc', 'ended_at_utc'
  ]
};

/** Idempotent; does not delete rows, replace headers, or generate a secret. */
function setup() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    assert_(ss, 'SETUP_BOUND_SHEET_REQUIRED');
    var props = PropertiesService.getScriptProperties();
    var previous = props.getProperty('SPREADSHEET_ID');
    assert_(!previous || previous === ss.getId(), 'SETUP_SPREADSHEET_MISMATCH');
    Object.keys(HEADERS).forEach(function (name) {
      var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
      if (sheet.getLastRow() === 0) {
        ensureGrid_(sheet, 1, HEADERS[name].length);
        sheet.getRange(1, 1, 1, HEADERS[name].length).setNumberFormat('@').setValues([HEADERS[name]]);
        sheet.setFrozenRows(1);
      }
      checkHeaders_(sheet, name);
    });
    SpreadsheetApp.flush();
    props.setProperty('SPREADSHEET_ID', ss.getId());
  } finally {
    lock.releaseLock();
  }
}

/** Health only. No sheet access, secret, row counts, participant lookup, or JSONP. */
function doGet() {
  return json_({ ok: true, service: 'focus-jump-lab', protocolVersion: FJL.protocolVersion });
}

/** Only this endpoint writes. Errors deliberately do not echo any submitted data. */
function doPost(e) {
  var submissionId;
  var lock;
  var acquired = false;
  try {
    assert_(e && e.postData && typeof e.postData.contents === 'string', 'INVALID_BODY');
    var body = e.postData.contents;
    assert_(body.length > 0 && body.length <= FJL.maxBodyBytes, 'BODY_TOO_LARGE');
    assert_(Utilities.newBlob(body).getBytes().length <= FJL.maxBodyBytes, 'BODY_TOO_LARGE');
    assert_(typeof e.postData.type === 'string' &&
      e.postData.type.toLowerCase().split(';')[0].trim() === 'text/plain', 'CONTENT_TYPE');
    var envelope;
    try { envelope = JSON.parse(body); } catch (_) { fail_('INVALID_JSON'); }
    assert_(object_(envelope), 'INVALID_ENVELOPE');
    if (id_(envelope.submissionId)) submissionId = envelope.submissionId;
    var props = PropertiesService.getScriptProperties();
    var sheetId = props.getProperty('SPREADSHEET_ID');
    var expectedCode = props.getProperty('COLLECTION_CODE');
    assert_(sheetId && typeof expectedCode === 'string' &&
      expectedCode.length >= 24 && expectedCode.length <= 128, 'NOT_CONFIGURED');
    assert_(typeof envelope.collectionCode === 'string' &&
      envelope.collectionCode.length <= 128 &&
      secretEqual_(expectedCode, envelope.collectionCode), 'UNAUTHORIZED');
    validateEnvelope_(envelope);
    lock = LockService.getScriptLock();
    acquired = lock.tryLock(10000);
    assert_(acquired, 'BUSY_RETRY');
    persist_(SpreadsheetApp.openById(sheetId), envelope);
    // No positive receipt before every write has been flushed successfully.
    SpreadsheetApp.flush();
    return json_({ ok: true, submissionId: submissionId, receivedAt: new Date().toISOString() });
  } catch (error) {
    var receipt = { ok: false, error: error && error.fjlCode ? error.fjlCode : 'WRITE_FAILED_RETRY' };
    if (submissionId) receipt.submissionId = submissionId;
    return json_(receipt);
  } finally {
    if (acquired) lock.releaseLock();
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function fail_(code) { var error = new Error(code); error.fjlCode = code; throw error; }
function assert_(condition, code) { if (!condition) fail_(code); }
function object_(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function id_(v) { return typeof v === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(v); }
function text_(v, max) { return typeof v === 'string' && v.length <= max; }
function keys_(v, required, optional) {
  assert_(object_(v), 'INVALID_SHAPE');
  var allowed = required.concat(optional || []);
  assert_(required.every(function (k) { return Object.prototype.hasOwnProperty.call(v, k); }) &&
    Object.keys(v).every(function (k) { return allowed.indexOf(k) >= 0; }), 'INVALID_SHAPE');
}
function utc_(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) &&
    Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
}
function canonical_(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical_).join(',') + ']';
  if (object_(v)) return '{' + Object.keys(v).sort().map(function (k) {
    return JSON.stringify(k) + ':' + canonical_(v[k]);
  }).join(',') + '}';
  return JSON.stringify(v);
}
function hash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function secretEqual_(a, b) {
  // Compare fixed-length hashes, never retain/log the supplied code.
  var x = hash_(a), y = hash_(b), difference = 0;
  for (var i = 0; i < x.length; i++) difference |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return difference === 0;
}
function safeCell_(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) return "'" + value;
  return value;
}
function keyValue_(value) {
  // IDs never contain apostrophes. Sheets may retain or consume the text escape.
  return typeof value === 'string' ? value.replace(/^'(?=[=+\-@\t\r])/, '') : String(value);
}

/** Keep this mirror aligned with buildSteps(); a Node test compares every group. */
function buildSteps_(group) {
  var steps = [
    { id: 'prep', kind: 'prep', visit: 0 },
    { id: 'baseline-1', kind: 'baseline', visit: 0, trial: 1 },
    { id: 'baseline-2', kind: 'baseline', visit: 0, trial: 2 }
  ];
  FJL.groups[group].forEach(function (session, i) {
    var visit = i + 1, base = { visit: visit, pressure: session.pressure };
    function add(extra) { steps.push(Object.assign({}, base, extra)); }
    if (visit === 2) add({ id: 'interval', kind: 'interval' });
    add({ id: 'v' + visit + '-intro', kind: 'intro' });
    add({ id: 'v' + visit + '-mrf', kind: 'mrf' });
    session.focus.forEach(function (focus, j) {
      var block = j + 1, prefix = 'v' + visit + '-b' + block;
      if (j === 1) add({ id: 'v' + visit + '-rest', kind: 'rest' });
      add({ id: prefix + '-cue', kind: 'cue', focus: focus, block: block });
      for (var trial = 1; trial <= 2; trial++)
        add({ id: prefix + '-t' + trial, kind: 'jump', focus: focus, block: block, trial: trial });
      add({ id: prefix + '-focus', kind: 'focus', focus: focus, block: block });
    });
    add({ id: 'v' + visit + '-pressure', kind: 'pressure' });
    add({ id: 'v' + visit + '-end', kind: 'visitEnd' });
  });
  steps.push({ id: 'complete', kind: 'complete', visit: 2 });
  return steps;
}

function validateEnvelope_(envelope) {
  keys_(envelope, ['schemaVersion', 'protocolVersion', 'submissionId', 'sentAt', 'collectionCode', 'participant']);
  assert_(envelope.schemaVersion === FJL.schemaVersion, 'SCHEMA_VERSION');
  assert_(envelope.protocolVersion === FJL.protocolVersion, 'PROTOCOL_VERSION');
  assert_(id_(envelope.submissionId) && utc_(envelope.sentAt), 'INVALID_SUBMISSION');
  var p = envelope.participant;
  keys_(p, ['id', 'code', 'group', 'isDemo', 'researcher', 'createdAt',
    'consentConfirmed', 'eligibilityConfirmed', 'protocolReviewed', 'stepIndex', 'status', 'responses', 'notes']);
  assert_(id_(p.id) && typeof p.code === 'string' && /^[A-Za-z0-9_-]{1,30}$/.test(p.code), 'INVALID_PARTICIPANT_ID');
  assert_(Object.prototype.hasOwnProperty.call(FJL.groups, p.group), 'INVALID_GROUP');
  assert_(p.isDemo === false, 'DEMO_REJECTED');
  assert_(p.consentConfirmed === true && p.eligibilityConfirmed === true &&
    p.protocolReviewed === true, 'CONSENT_REQUIRED');
  assert_(text_(p.researcher, 60) && text_(p.notes, 2000) && utc_(p.createdAt), 'INVALID_PARTICIPANT');
  var steps = buildSteps_(p.group);
  assert_(Array.isArray(p.responses) && Number.isInteger(p.stepIndex) && p.stepIndex >= 0 &&
    p.stepIndex < steps.length && p.responses.length === p.stepIndex, 'STEP_INDEX');
  assert_(['active', 'completed', 'withdrawn'].indexOf(p.status) >= 0 &&
    (p.status !== 'completed' || steps[p.stepIndex].kind === 'complete'), 'INVALID_STATUS');
  var previous = p.createdAt;
  p.responses.forEach(function (r, index) {
    keys_(r, ['stepId', 'kind', 'visit', 'startedAt', 'completedAt', 'values'],
      ['pressure', 'focus', 'block', 'trial', 'missingReason']);
    var step = steps[index];
    assert_(r.stepId === step.id && ['kind', 'visit', 'pressure', 'focus', 'block', 'trial']
      .every(function (k) { return r[k] === step[k]; }), 'RESPONSE_ORDER');
    assert_(utc_(r.startedAt) && utc_(r.completedAt) &&
      r.startedAt >= previous && r.completedAt >= r.startedAt && r.completedAt <= envelope.sentAt, 'RESPONSE_TIME');
    previous = r.completedAt;
    assert_(r.missingReason === undefined || (text_(r.missingReason, 2000) &&
      r.missingReason.trim().length > 0), 'MISSING_REASON');
    assert_(object_(r.values) && canonical_(r.values).length <= 8000, 'INVALID_VALUES');
    validateValueTree_(r.values, 0);
    if (step.kind === 'jump' || step.kind === 'baseline') {
      keys_(r.values, ['distance', 'validity', 'reason'], ['unit']);
      var v = r.values;
      assert_(v.unit === undefined || v.unit === 'cm', 'TRIAL_UNIT');
      assert_(text_(v.reason, 2000), 'TRIAL_REASON');
      assert_(['valid', 'foul', 'missing'].indexOf(v.validity) >= 0, 'TRIAL_VALIDITY');
      if (v.validity === 'valid') {
        assert_(typeof v.distance === 'number' && Number.isFinite(v.distance) &&
          v.distance > 0 && v.distance <= 500, 'TRIAL_DISTANCE');
      } else {
        assert_(v.distance === null && v.reason.trim().length > 0, 'TRIAL_REASON');
      }
    }
    var questions = step.kind === 'mrf' ?
      [['cognitive_anxiety', 1, 11], ['somatic_anxiety', 1, 11], ['self_confidence', 1, 11]] :
      step.kind === 'focus' ? [['focus_adherence', 0, 100], ['internal_focus', 0, 100]] :
      step.kind === 'pressure' ? [['evaluation_pressure', 1, 7]] : [];
    if (questions.length) {
      keys_(r.values, questions.map(function (q) { return q[0]; }),
        ['question_version', 'response_time_ms', 'response_methods', 'item_timestamps']);
      validateQuestionMetadata_(r, questions);
    }
    questions.forEach(function (q) {
      var value = r.values[q[0]];
      assert_((value === null && !!r.missingReason) ||
        (Number.isInteger(value) && value >= q[1] && value <= q[2]), 'SCORE_RANGE');
    });
    if (!questions.length && step.kind !== 'baseline' && step.kind !== 'jump') validateProcedure_(r);
  });
  assert_(p.createdAt <= envelope.sentAt, 'RESPONSE_TIME');
}

function validateQuestionMetadata_(r, questions) {
  var v = r.values, questionKeys = questions.map(function (q) { return q[0]; });
  assert_(v.question_version === undefined || v.question_version === FJL.questionVersion, 'QUESTION_VERSION');
  assert_(v.response_time_ms === undefined || (Number.isInteger(v.response_time_ms) &&
    v.response_time_ms >= 0 && v.response_time_ms <= Date.parse(r.completedAt) - Date.parse(r.startedAt) + 1000),
    'RESPONSE_TIME');
  if (v.response_methods !== undefined) {
    keys_(v.response_methods, [], questionKeys);
    Object.keys(v.response_methods).forEach(function (key) {
      assert_(['radio', 'range', 'keyboard', 'numeric'].indexOf(v.response_methods[key]) >= 0, 'RESPONSE_METHOD');
    });
  }
  if (v.item_timestamps !== undefined) {
    keys_(v.item_timestamps, [], questionKeys);
    Object.keys(v.item_timestamps).forEach(function (key) {
      var item = v.item_timestamps[key];
      keys_(item, ['answeredAt']);
      assert_(utc_(item.answeredAt) && item.answeredAt >= r.startedAt &&
        item.answeredAt <= r.completedAt, 'RESPONSE_TIME');
    });
  }
}

function validateProcedure_(r) {
  var v = r.values;
  if (r.kind === 'prep') {
    keys_(v, ['warmup', 'hf_teachback', 'ef_teachback']);
    assert_(v.warmup === true && v.hf_teachback === true && v.ef_teachback === true, 'PROCEDURE_CONFIRMATION');
  } else if (r.kind === 'intro') {
    keys_(v, ['pressure_setup_confirmed']);
    assert_(v.pressure_setup_confirmed === true, 'PROCEDURE_CONFIRMATION');
  } else if (r.kind === 'cue') {
    keys_(v, ['cue', 'instruction_confirmed']);
    assert_(v.instruction_confirmed === true &&
      v.cue === (r.focus === 'HF' ? '폭발적으로' : '콘 쪽을 향해'), 'PROCEDURE_CONFIRMATION');
  } else if (r.kind === 'visitEnd') {
    keys_(v, ['backup_confirmed']);
    assert_(v.backup_confirmed === true, 'PROCEDURE_CONFIRMATION');
  } else if (r.kind === 'rest') {
    keys_(v, ['rest_seconds', 'planned_seconds', 'timer_started_at', 'protocol_deviation', 'deviation_reason']);
    assert_(Number.isInteger(v.rest_seconds) && v.rest_seconds >= 0 &&
      v.planned_seconds === 600 && v.protocol_deviation === (v.rest_seconds < 600), 'REST_VALUES');
    assert_((v.timer_started_at === null && v.rest_seconds === 0) ||
      (utc_(v.timer_started_at) && v.timer_started_at >= r.startedAt &&
        v.timer_started_at <= r.completedAt), 'RESPONSE_TIME');
    assert_(text_(v.deviation_reason, 2000) &&
      (!v.protocol_deviation || v.deviation_reason.trim().length > 0), 'DEVIATION_REASON');
  } else if (r.kind === 'interval') {
    keys_(v, ['elapsed_hours', 'minimum_hours', 'protocol_deviation', 'deviation_reason', 'eligibility_reconfirmed']);
    assert_(typeof v.elapsed_hours === 'number' && Number.isFinite(v.elapsed_hours) && v.elapsed_hours >= 0 &&
      v.minimum_hours === 48 && typeof v.protocol_deviation === 'boolean' &&
      (v.protocol_deviation || v.elapsed_hours >= 48) && v.eligibility_reconfirmed === true, 'INTERVAL_VALUES');
    assert_(text_(v.deviation_reason, 2000) &&
      (!v.protocol_deviation || v.deviation_reason.trim().length > 0), 'DEVIATION_REASON');
  } else {
    fail_('RESPONSE_ORDER');
  }
}

function validateValueTree_(value, depth) {
  assert_(depth <= 5, 'INVALID_VALUES');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { assert_(Number.isFinite(value), 'INVALID_VALUES'); return; }
  if (typeof value === 'string') { assert_(text_(value, 2000), 'INVALID_VALUES'); return; }
  assert_(object_(value) || Array.isArray(value), 'INVALID_VALUES');
  var keys = Object.keys(value);
  assert_(keys.length <= 30, 'INVALID_VALUES');
  keys.forEach(function (key) {
    assert_(['__proto__', 'constructor', 'prototype'].indexOf(key) < 0 &&
      (Array.isArray(value) || /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)), 'INVALID_VALUES');
    validateValueTree_(value[key], depth + 1);
  });
}

function checkHeaders_(sheet, name) {
  var headers = HEADERS[name];
  assert_(sheet.getLastColumn() === headers.length &&
    canonical_(sheet.getRange(1, 1, 1, headers.length).getValues()[0]) === canonical_(headers), 'SHEET_HEADERS');
}
function ensureGrid_(sheet, rows, columns) {
  if (sheet.getMaxColumns() < columns)
    sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
  if (sheet.getMaxRows() < rows)
    sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
}
function table_(ss, name) {
  var sheet = ss.getSheetByName(name);
  assert_(sheet, 'SETUP_REQUIRED');
  checkHeaders_(sheet, name);
  var n = sheet.getLastRow();
  assert_(n <= FJL.maxRows, 'SHEET_CAPACITY');
  var rows = n > 1 ? sheet.getRange(2, 1, n - 1, HEADERS[name].length).getValues() : [];
  var index = Object.create(null);
  rows.forEach(function (row, i) {
    var key = keyValue_(row[0]);
    assert_(key && !Object.prototype.hasOwnProperty.call(index, key), 'SHEET_DUPLICATE_KEY');
    var record = {};
    HEADERS[name].forEach(function (h, c) { record[h] = row[c]; });
    index[key] = { row: i + 2, data: record };
  });
  return { name: name, sheet: sheet, next: n + 1, index: index };
}
function put_(table, key, record) {
  var existing = table.index[key], row = existing ? existing.row : table.next++;
  assert_(row <= FJL.maxRows, 'SHEET_CAPACITY');
  var values = HEADERS[table.name].map(function (h) { return safeCell_(record[h]); });
  // Plain text format AND escaping stop formulas in free text, including JSON cells.
  ensureGrid_(table.sheet, row, values.length);
  table.sheet.getRange(row, 1, 1, values.length).setNumberFormat('@').setValues([values]);
  table.index[key] = { row: row, data: record };
}
function context_(p) {
  var sessions = FJL.groups[p.group];
  return {
    participant_id: p.id, participant_code: p.code, group: p.group,
    protocol_version: FJL.protocolVersion, question_version: FJL.questionVersion,
    session_order: sessions.map(function (s) { return s.pressure; }).join('>'),
    focus_order: sessions.map(function (s, i) { return 'v' + (i + 1) + ':' + s.focus.join('>'); }).join('|')
  };
}
function identity_(p) {
  return hash_(canonical_({
    id: p.id, code: p.code, group: p.group, isDemo: p.isDemo, createdAt: p.createdAt,
    consentConfirmed: p.consentConfirmed, eligibilityConfirmed: p.eligibilityConfirmed,
    protocolReviewed: p.protocolReviewed, protocolVersion: FJL.protocolVersion
  }));
}
function responseRow_(p, r, index) {
  var row = Object.assign(context_(p), {
    response_key: p.id + ':' + r.stepId, trial_key: p.id + ':' + r.stepId,
    step_index: index, step_id: r.stepId, kind: r.kind, visit: r.visit,
    pressure: r.pressure, focus: r.focus, block: r.block, trial: r.trial,
    started_at_utc: r.startedAt, ended_at_utc: r.completedAt,
    missing_reason: r.missingReason, values_json: canonical_(r.values),
    response_hash: hash_(canonical_(r)), identity_hash: identity_(p)
  });
  ['cognitive_anxiety', 'somatic_anxiety', 'self_confidence', 'focus_adherence',
    'internal_focus', 'evaluation_pressure', 'validity', 'reason'].forEach(function (key) {
    row[key] = r.values[key];
  });
  row.distance_cm = r.values.distance;
  return row;
}

function persist_(ss, envelope) {
  var p = envelope.participant, tables = {};
  // Preflight all headers and historic conflicts BEFORE any write.
  Object.keys(HEADERS).forEach(function (name) { tables[name] = table_(ss, name); });
  var previous = tables.Participants.index[p.id];
  if (previous) assert_(previous.data.identity_hash === identity_(p), 'PARTICIPANT_CONFLICT');
  // Prevent accidental code reuse under a different ID.
  Object.keys(tables.Participants.index).forEach(function (id) {
    var data = tables.Participants.index[id].data;
    assert_(id === p.id || keyValue_(data.participant_code) !== p.code, 'PARTICIPANT_CODE_CONFLICT');
  });
  var incoming = p.responses.map(function (r, i) { return responseRow_(p, r, i); });
  incoming.forEach(function (row) {
    var old = tables.Responses.index[row.response_key];
    assert_(!old || old.data.response_hash === row.response_hash, 'RESPONSE_CONFLICT');
    var trial = tables.Trials.index[row.trial_key];
    assert_(!trial || trial.data.response_hash === row.response_hash, 'TRIAL_CONFLICT');
  });
  var all = Object.create(null);
  Object.keys(tables.Responses.index).forEach(function (key) {
    var row = tables.Responses.index[key].data;
    if (keyValue_(row.participant_id) === p.id) {
      assert_(keyValue_(row.participant_code) === p.code && row.group === p.group &&
        row.identity_hash === identity_(p), 'PARTICIPANT_CONFLICT');
      all[row.step_id] = row;
    }
    assert_(keyValue_(row.participant_id) === p.id ||
      keyValue_(row.participant_code) !== p.code, 'PARTICIPANT_CODE_CONFLICT');
  });
  incoming.forEach(function (row) { all[row.step_id] = row; });
  var rows = Object.keys(all).map(function (key) { return all[key]; })
    .sort(function (a, b) { return a.step_index - b.step_index; });
  var steps = buildSteps_(p.group);
  rows.forEach(function (r, i) {
    assert_(r.step_index === i && r.step_id === steps[i].id, 'SHEET_HISTORY');
  });
  assert_(!previous || previous.data.response_count <= rows.length, 'SHEET_HISTORY');
  var stale = p.responses.length < rows.length ||
    (previous && envelope.sentAt < previous.data.last_sent_at_utc);
  if (previous && !stale) {
    var terminal = previous.data.status === 'completed' || previous.data.status === 'withdrawn';
    assert_(!terminal || (p.status === previous.data.status && p.stepIndex === previous.data.step_index), 'STATUS_CONFLICT');
  }
  // Missing trial rows from a partial earlier request are rebuilt from response rows.
  var jumps = rows.filter(function (r) { return r.kind === 'baseline' || r.kind === 'jump'; });
  jumps.forEach(function (r) {
    var key = p.id + ':' + r.step_id, old = tables.Trials.index[key];
    assert_(!old || old.data.response_hash === r.response_hash, 'TRIAL_CONFLICT');
  });
  incoming.forEach(function (row) {
    if (!tables.Responses.index[row.response_key]) put_(tables.Responses, row.response_key, row);
  });
  jumps.forEach(function (row) {
    var key = p.id + ':' + row.step_id;
    if (!tables.Trials.index[key]) put_(tables.Trials, key, Object.assign({}, row, { trial_key: key }));
  });
  var aggregates = {};
  ['baseline', 'lowHF', 'lowEF', 'highHF', 'highEF'].forEach(function (condition) {
    var pressure = condition === 'baseline' ? '' : condition.slice(0, -2);
    var focus = condition === 'baseline' ? '' : condition.slice(-2);
    var selected = jumps.filter(function (r) {
      return condition === 'baseline' ? r.kind === 'baseline' :
        r.kind === 'jump' && r.pressure === pressure && r.focus === focus;
    });
    var valid = selected.filter(function (r) {
      return r.validity === 'valid' && typeof r.distance_cm === 'number' &&
        Number.isFinite(r.distance_cm) && r.distance_cm > 0 && r.distance_cm <= 500;
    }).map(function (r) { return r.distance_cm; });
    var aggregate = {
      max_cm: valid.length ? Math.max.apply(null, valid) : null,
      mean_cm: valid.length ? Math.round(valid.reduce(function (a, b) { return a + b; }, 0) / valid.length * 100) / 100 : null,
      valid_n: valid.length, recorded_n: selected.length
    };
    aggregates[condition] = aggregate;
    var visit = pressure ? FJL.groups[p.group].findIndex(function (s) { return s.pressure === pressure; }) + 1 : 0;
    var block = visit ? FJL.groups[p.group][visit - 1].focus.indexOf(focus) + 1 : '';
    var key = p.id + ':' + condition;
    put_(tables.Conditions, key, Object.assign(context_(p), aggregate, {
      condition_key: key, condition: condition, visit: visit, pressure: pressure, focus: focus, block: block,
      started_at_utc: selected.length ? selected[0].started_at_utc : '',
      ended_at_utc: selected.length ? selected[selected.length - 1].ended_at_utc : ''
    }));
  });
  // Participants is the commit summary, written last; history never shrinks on stale retries.
  var participant = stale && previous ? Object.assign({}, previous.data) : Object.assign(context_(p), {
    is_demo: false, researcher: p.researcher, created_at_utc: p.createdAt,
    consent_confirmed: true, eligibility_confirmed: true, protocol_reviewed: true,
    step_index: p.stepIndex, status: p.status, notes: p.notes,
    last_submission_id: envelope.submissionId, last_sent_at_utc: envelope.sentAt,
    received_at_utc: new Date().toISOString(), identity_hash: identity_(p)
  });
  participant.step_index = rows.length;
  participant.response_count = rows.length;
  participant.started_at_utc = rows.length ? rows[0].started_at_utc : '';
  participant.ended_at_utc = rows.length ? rows[rows.length - 1].ended_at_utc : '';
  Object.keys(aggregates).forEach(function (condition) {
    participant[condition + '_max_cm'] = aggregates[condition].max_cm;
    participant[condition + '_mean_cm'] = aggregates[condition].mean_cm;
    participant[condition + '_valid_n'] = aggregates[condition].valid_n;
  });
  participant.high_difference_cm = aggregates.highHF.max_cm !== null && aggregates.highEF.max_cm !== null ?
    Math.round((aggregates.highHF.max_cm - aggregates.highEF.max_cm) * 100) / 100 : null;
  put_(tables.Participants, p.id, participant);
}
