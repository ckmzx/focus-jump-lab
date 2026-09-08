export type Group = 'A' | 'B' | 'C' | 'D';
export type Pressure = 'low' | 'high';
export type Focus = 'HF' | 'EF';
export type StepKind = 'prep' | 'baseline' | 'intro' | 'mrf' | 'cue' | 'jump' | 'focus' | 'rest' | 'pressure' | 'visitEnd' | 'interval' | 'complete';
export interface Step {
  id: string;
  kind: StepKind;
  label: string;
  visit: number;
  pressure?: Pressure;
  focus?: Focus;
  block?: number;
  trial?: number;
}
export interface TrialValue {
  distance: number | null;
  validity: 'valid' | 'foul' | 'missing';
  reason: string;
}
export interface Response {
  stepId: string;
  kind: StepKind;
  visit: number;
  pressure?: Pressure;
  focus?: Focus;
  block?: number;
  trial?: number;
  startedAt: string;
  completedAt: string;
  values: Record<string, unknown>;
  missingReason?: string;
}
export interface Participant {
  id: string;
  code: string;
  group: Group;
  isDemo: boolean;
  researcher: string;
  createdAt: string;
  consentConfirmed: boolean;
  eligibilityConfirmed: boolean;
  protocolReviewed: boolean;
  stepIndex: number;
  status: 'active' | 'completed' | 'withdrawn';
  responses: Response[];
  notes: string;
}
export interface StudyBackup {
  schemaVersion: 1;
  protocolVersion: string;
  exportedAt: string;
  participants: Participant[];
}
export interface SyncEnvelope {
  schemaVersion: 1;
  protocolVersion: string;
  submissionId: string;
  sentAt: string;
  collectionCode: string;
  participant: Participant;
}
export interface SyncReceipt {
  ok: boolean;
  submissionId?: string;
  receivedAt?: string;
  error?: string;
}
