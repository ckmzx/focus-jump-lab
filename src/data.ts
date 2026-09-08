import type { Participant, StudyBackup } from '../shared/schema';
import { GROUPS, PROTOCOL_VERSION, summarize } from './protocol';

export function download(name: string, content: string, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
export function backup(participants: Participant[]) {
  const data: StudyBackup = { schemaVersion: 1, protocolVersion: PROTOCOL_VERSION, exportedAt: new Date().toISOString(), participants };
  download(`focus-lab-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(data, null, 2), 'application/json');
}
export function csvCell(v: unknown) {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function toCSV(rows: Record<string, unknown>[], headers?: string[]) {
  const keys = headers || [...new Set(rows.flatMap(row => Object.keys(row)))];
  return '\ufeff' + [keys.map(csvCell).join(','), ...rows.map(row => keys.map(k => csvCell(row[k])).join(','))].join('\r\n');
}
export function exportRows(participants: Participant[], type: 'responses' | 'conditions' | 'participants') {
  const rows: Record<string, unknown>[] = [];
  for (const p of participants) {
    const s = summarize(p);
    const base = { participant_id: p.id, participant_code: p.code, is_demo: p.isDemo, group: p.group, status: p.status, protocol_version: PROTOCOL_VERSION, session_order: GROUPS[p.group].map(v => v.pressure).join('>') };
    if (type === 'responses') {
      for (const r of p.responses) rows.push({ ...base, step_id: r.stepId, kind: r.kind, visit: r.visit, pressure: r.pressure, focus: r.focus, block: r.block, trial: r.trial, focus_order: r.visit ? GROUPS[p.group][r.visit - 1].focus.join('>') : '', started_at_utc: r.startedAt, completed_at_utc: r.completedAt, missing_reason: r.missingReason || '', ...Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : v])) });
    } else if (type === 'conditions') {
      for (const [key, result] of Object.entries(s)) if (typeof result === 'object' && result) rows.push({ ...base, condition: key, best_cm: result.best, mean_valid_cm: result.mean, valid_n: result.validN, recorded_n: result.recordedN, complete_two_valid: result.validN === 2 });
    } else rows.push({ ...base, researcher_code: p.researcher, created_at_utc: p.createdAt, consent_confirmed: p.consentConfirmed, eligibility_confirmed: p.eligibilityConfirmed, protocol_reviewed: p.protocolReviewed, baseline_best_cm: s.baseline.best, high_hf_best_cm: s.highHF.best, high_ef_best_cm: s.highEF.best, high_hf_minus_ef_cm: s.highDifference, response_count: p.responses.length, notes: p.notes });
  }
  return rows;
}
export function exportCSV(participants: Participant[], type: 'responses' | 'conditions' | 'participants') {
  download(`focus-lab-${type}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(exportRows(participants, type)), 'text/csv;charset=utf-8');
}
export function allocationCSV(n: number) {
  if (!Number.isInteger(n) || n < 4 || n > 500 || n % 4 !== 0) throw new Error('4의 배수로 입력하세요 (4~500명).');
  const result: Record<string, unknown>[] = [];
  const randomBelow = (max: number) => {
    const buf = new Uint32Array(1), cap = Math.floor(2 ** 32 / max) * max;
    do { crypto.getRandomValues(buf); } while (buf[0] >= cap);
    return buf[0] % max;
  };
  for (let i = 0; i < n; i += 4) {
    const block = ['A', 'B', 'C', 'D'] as const;
    const shuffled = [...block];
    for (let j = 3; j > 0; j--) { const k = randomBelow(j + 1); [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]]; }
    shuffled.forEach((group, j) => result.push({ sequence: i + j + 1, participant_code: `P${String(i + j + 1).padStart(3, '0')}`, group, visit1: GROUPS[group][0].pressure, visit1_focus: GROUPS[group][0].focus.join('>'), visit2: GROUPS[group][1].pressure, visit2_focus: GROUPS[group][1].focus.join('>') }));
  }
  download('focus-lab-allocation.csv', toCSV(result), 'text/csv;charset=utf-8');
}
