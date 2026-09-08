import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, Plus, LayoutDashboard, Users, Table2, BookOpen, Settings2, Download, Upload, ChevronRight, Check, CheckCircle2, Clock3, ExternalLink, X, Sun, Moon, Link2, Play, Pause, RotateCcw, AlertCircle, Maximize2, Menu, ShieldCheck, FileJson, CircleHelp } from 'lucide-react';
import type { Group, Participant, Response, Step, SyncEnvelope } from '../shared/schema';
import { buildSteps, CUES, FOCUS_LABEL, GROUPS, MRF_QUESTIONS, PRESSURE_LABEL, PRESSURE_QUESTION, PROTOCOL_VERSION, QUESTION_VERSION, focusQuestions, summarize, validateBackup, type Question } from './protocol';
import { allocationCSV, backup, exportCSV } from './data';

type Page = 'experiment' | 'participants' | 'data' | 'protocol' | 'settings';
type Connection = { url: string; code: string; auto: boolean };
type SaveStatus = { state: 'pending' | 'sending' | 'synced' | 'error'; text: string };
const navigation = [
  { key: 'experiment', label: '실험 진행', icon: LayoutDashboard },
  { key: 'participants', label: '참여자 관리', icon: Users },
  { key: 'data', label: '측정 데이터', icon: Table2 },
  { key: 'protocol', label: '연구 프로토콜', icon: BookOpen },
  { key: 'settings', label: '연결 설정', icon: Settings2 },
] as const;
function Logo() {
  return <div className="brand"><svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-label="Focus Lab 로고"><path d="M6 26V6h21M6 16h15" stroke="currentColor" strokeWidth="3.5" /><circle cx="26" cy="26" r="3" fill="currentColor" /></svg><span>focus<span className="brand-light">lab</span><small>HUMAN PERFORMANCE</small></span></div>;
}
function Button({ children, onClick, secondary = false, disabled = false, type = 'button', className = '', testId }: { children: React.ReactNode; onClick?: () => void; secondary?: boolean; disabled?: boolean; type?: 'button' | 'submit'; className?: string; testId?: string }) {
  return <button type={type} data-testid={testId} onClick={onClick} disabled={disabled} className={`button ${secondary ? 'secondary' : 'primary'} ${className}`}>{children}</button>;
}
function Banner({ children, warning = false }: { children: React.ReactNode; warning?: boolean }) { return <div className={`banner ${warning ? 'warning' : ''}`}><AlertCircle size={17} /><div>{children}</div></div>; }
function Tag({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) { return <span className={`tag ${accent ? 'accent' : ''}`}>{children}</span>; }
function fmt(n: number | null) { return n === null ? '—' : n.toFixed(1); }
function localDate(s: string) { return new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function sessionDescription(group: Group, v: number) { const s = GROUPS[group][v - 1]; return `${PRESSURE_LABEL[s.pressure]} · ${s.focus.join(' → ')}`; }

export function App() {
  const [page, setPage] = useState<Page>('experiment');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newModal, setNewModal] = useState(false);
  const [survey, setSurvey] = useState<Step | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [connection, setConnection] = useState<Connection>({ url: '', code: '', auto: false });
  const [statuses, setStatuses] = useState<Record<string, SaveStatus>>({});
  const [notice, setNotice] = useState('');
  const [unsaved, setUnsaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef(new Map<string, SyncEnvelope>());
  const syncQueue = useRef(Promise.resolve());
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const selected = participants.find(p => p.id === selectedId);
  const actual = participants.filter(p => !p.isDemo);

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => {
    document.title = `${navigation.find(n => n.key === page)?.label} · Focus Lab`;
  }, [page]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (unsaved) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [unsaved]);

  function sendEnvelope(env: SyncEnvelope) {
    const conn = connectionRef.current;
    if (!conn.url || !conn.code || env.participant.isDemo) return;
    const job = async () => {
      if (pending.current.get(env.participant.id)?.submissionId !== env.submissionId) return;
      setStatuses(s => ({ ...s, [env.participant.id]: { state: 'sending', text: 'Google 응답 확인 중' } }));
      try {
        const response = await fetch(conn.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', credentials: 'omit', body: JSON.stringify({ ...env, collectionCode: conn.code }), signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.ok !== true || data.submissionId !== env.submissionId) throw new Error(typeof data.error === 'string' ? data.error : '저장 확인 응답이 일치하지 않습니다.');
        if (pending.current.get(env.participant.id)?.submissionId === env.submissionId) {
          pending.current.delete(env.participant.id);
          setStatuses(s => ({ ...s, [env.participant.id]: { state: 'synced', text: 'Google Sheets 저장 확인' } }));
        }
      } catch (error) {
        if (pending.current.get(env.participant.id)?.submissionId === env.submissionId) setStatuses(s => ({ ...s, [env.participant.id]: { state: 'error', text: `저장 미확인 · ${error instanceof Error ? error.message : '네트워크 오류'}` } }));
      }
    };
    syncQueue.current = syncQueue.current.then(job, job);
  }
  function persist(p: Participant) {
    setParticipants(list => list.some(x => x.id === p.id) ? list.map(x => x.id === p.id ? p : x) : [...list, p]);
    setUnsaved(true);
    if (p.isDemo) return;
    const env: SyncEnvelope = { schemaVersion: 1, protocolVersion: PROTOCOL_VERSION, submissionId: crypto.randomUUID(), sentAt: new Date().toISOString(), collectionCode: '', participant: p };
    pending.current.set(p.id, env);
    setStatuses(s => ({ ...s, [p.id]: { state: 'pending', text: '전송 대기' } }));
    if (connectionRef.current.auto) sendEnvelope(env);
  }
  function finishStep(step: Step, values: Record<string, unknown>, startedAt: string, missingReason?: string) {
    if (!selected || buildSteps(selected.group)[selected.stepIndex].id !== step.id || selected.responses.some(r => r.stepId === step.id)) return;
    const response: Response = { stepId: step.id, kind: step.kind, visit: step.visit, pressure: step.pressure, focus: step.focus, block: step.block, trial: step.trial, startedAt, completedAt: new Date().toISOString(), values, ...(missingReason ? { missingReason } : {}) };
    const nextIndex = selected.stepIndex + 1;
    persist({ ...selected, stepIndex: nextIndex, responses: [...selected.responses, response], status: buildSteps(selected.group)[nextIndex].kind === 'complete' ? 'completed' : 'active' });
    setSurvey(null);
  }
  function doBackup() { backup(participants); setUnsaved(false); setNotice('JSON 백업을 다운로드했습니다. 파일이 기기에 저장되었는지 확인하세요.'); }
  async function importBackup(file: File) {
    try {
      if (file.size > 12_000_000) throw new Error('12MB 이하의 JSON 파일을 선택하세요.');
      const data = validateBackup(JSON.parse(await file.text()));
      const incoming = data.participants;
      if (incoming.some(p => participants.some(x => (x.id === p.id || (x.code === p.code && x.isDemo === p.isDemo))))) throw new Error('현재 화면에 같은 참여자가 있습니다. 중복 덮어쓰기를 방지하기 위해 불러오기를 취소했습니다. 현재 데이터를 백업한 뒤 새 탭에서 복원하세요.');
      setParticipants(list => [...list, ...incoming]);
      if (incoming.length) setSelectedId(incoming[0].id);
      setPage('experiment'); setNotice(`${incoming.length}명의 백업을 불러왔습니다. Google Sheets 전송이 필요하면 연결 후 전송 대기를 등록하세요.`); setUnsaved(true);
    } catch (error) { setNotice(`불러오기 실패: ${error instanceof Error ? error.message : '파일을 확인하세요.'}`); }
  }
  function navigate(next: Page) { setPage(next); setMobileNav(false); window.scrollTo({ top: 0 }); }

  return <>
    <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus(); }}>본문으로 이동</a>
    <input ref={inputRef} type="file" accept=".json,application/json" className="sr-only" aria-label="JSON 백업 파일" data-testid="input-import" onChange={e => { const file = e.target.files?.[0]; if (file) void importBackup(file); e.currentTarget.value = ''; }} />
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <Logo />
      <div className="workspace-label">RESEARCH WORKSPACE</div>
      <nav aria-label="주 메뉴">{navigation.map(n => <button key={n.key} data-testid={`nav-${n.key}`} onClick={() => navigate(n.key)} className={`nav-item ${page === n.key ? 'active' : ''}`} aria-current={page === n.key ? 'page' : undefined}><n.icon size={19} />{n.label}{n.key === 'participants' && <span className="nav-count">{participants.length}</span>}</button>)}</nav>
      <div className="sidebar-study"><span className="eyebrow">CURRENT STUDY</span><strong>주의초점과<br />제자리멀리뛰기 수행</strong><p>HF × EF · 압박 조건 비교</p><Tag>반복측정 설계</Tag></div>
      <div className="sidebar-bottom"><span className="avatar">R</span><div><strong>연구자 워크스페이스</strong><span>프로토콜 v2 · 문항 초안</span></div></div>
    </aside>
    {mobileNav && <button className="nav-backdrop" aria-label="메뉴 닫기" onClick={() => setMobileNav(false)} />}
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="메뉴 열기" onClick={() => setMobileNav(!mobileNav)}><Menu size={21} /></button>
        <div className="breadcrumb"><span>연구 워크스페이스</span><ChevronRight size={14} /><strong>{navigation.find(n => n.key === page)?.label}</strong></div>
        <div className="header-actions"><span className="connection-label"><span className={`status-dot ${connection.auto ? 'blue' : ''}`} />{connection.auto ? 'Sheets 자동 전송 켜짐' : 'Sheets 미연결'}</span><button className="icon-button" aria-label={dark ? '밝은 화면으로 변경' : '어두운 화면으로 변경'} data-testid="toggle-theme" onClick={() => setDark(!dark)}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button><button className="text-button" data-testid="button-backup-header" disabled={!participants.length} onClick={doBackup}><Download size={17} /><span>백업</span></button></div>
      </header>
      <main id="main" tabIndex={-1}>
        {notice && <div role="status" className="notice">{notice}<button aria-label="알림 닫기" onClick={() => setNotice('')}><X size={18} /></button></div>}
        <div className="page-heading"><div><span className="eyebrow">{page === 'experiment' ? 'EXPERIMENT WORKSPACE' : 'FOCUS LAB / RESEARCH'}</span><h1>{page === 'experiment' ? '한 단계씩, 정확한 측정.' : navigation.find(n => n.key === page)?.label}</h1><p>{page === 'experiment' ? '연구계획에 맞춘 실험 진행과 참여자 설문을 한곳에서 관리하세요.' : page === 'data' ? '시행별 원자료와 조건별 요약을 확인하고 분석용 CSV로 내보내세요.' : page === 'participants' ? '익명 참여자 코드로 진행 상황을 구분합니다. 실명은 입력하지 마세요.' : page === 'protocol' ? '압박 상황에서 전체적 주의초점이 제자리멀리뛰기 수행에 미치는 효과' : 'Google Sheets 저장을 연결하고 데이터 보관 방식을 확인하세요.'}</p></div>
          {(page === 'experiment' || page === 'participants') && <Button onClick={() => setNewModal(true)} testId="button-new-participant"><Plus size={18} />새 참여자 등록</Button>}
        </div>
        <div className="storage-strip"><span><FileJson size={16} />{unsaved ? '백업이 필요한 변경사항이 있습니다.' : '이 화면의 데이터는 임시 보관됩니다.'}<span className="storage-detail"> 새로고침·종료 전 JSON 백업을 저장하세요.</span></span><button className="inline-link" data-testid="button-import" onClick={() => inputRef.current?.click()}><Upload size={15} />백업 불러오기</button></div>
        {page === 'experiment' && <>
          {!selected ? <Welcome onNew={() => setNewModal(true)} onSettings={() => navigate('settings')} onProtocol={() => navigate('protocol')} /> : <>
            <div className="participant-bar"><div className="participant-identity"><span className="avatar">{selected.isDemo ? 'T' : 'P'}</span><div><strong>{selected.code}</strong><span>{selected.group} 순서군 · {selected.isDemo ? '연습 데이터' : '실험 데이터'}</span></div><Tag accent>{selected.status === 'completed' ? '완료' : selected.status === 'withdrawn' ? '중단' : '진행 중'}</Tag></div><div className="participant-bar-actions">{selected.isDemo ? <span className="small muted">연습 응답은 Sheets로 전송하지 않습니다.</span> : <SaveBadge status={statuses[selected.id]} />}<button className="text-button" onClick={() => navigate('participants')}>참여자 변경<ChevronRight size={16} /></button></div></div>
            <div className="experiment-grid">
              <div className="step-column">{selected.status === 'withdrawn' ? <section className="panel"><h2>참여가 중단되었습니다.</h2><p>기존 응답은 그대로 보존합니다. 분석 포함 여부는 연구계획에 따라 검토하세요.</p><p className="inset">{selected.notes}</p><Button secondary onClick={doBackup}><Download size={17} />현재 데이터 백업</Button></section> :
                <StepPanel key={`${selected.id}-${selected.stepIndex}`} participant={selected} step={buildSteps(selected.group)[selected.stepIndex]} onFinish={finishStep} onSurvey={setSurvey} onBackup={doBackup} onData={() => navigate('data')} />}
                {selected.status === 'active' && <details className="research-options"><summary>연구자 예외 처리</summary><p>참여 중단은 되돌릴 수 없습니다. 이미 수집한 원자료는 삭제되지 않습니다.</p><Withdrawal onConfirm={reason => persist({ ...selected, status: 'withdrawn', notes: reason })} /></details>}
              </div>
              <Procedure participant={selected} />
            </div>
          </>}
        </>}
        {page === 'participants' && <ParticipantList participants={participants} selectedId={selectedId} statuses={statuses} onSelect={p => { setSelectedId(p.id); navigate('experiment'); }} onNew={() => setNewModal(true)} onBackup={doBackup} />}
        {page === 'data' && <DataView participants={participants} onBackup={doBackup} />}
        {page === 'protocol' && <ProtocolView />}
        {page === 'settings' && <SettingsView value={connection} onChange={setConnection} pendingCount={Object.values(statuses).filter(s => s.state !== 'synced').length} onRetry={() => {
          for (const p of actual) if (!pending.current.has(p.id) && statuses[p.id]?.state !== 'synced') {
            const env: SyncEnvelope = { schemaVersion: 1, protocolVersion: PROTOCOL_VERSION, submissionId: crypto.randomUUID(), sentAt: new Date().toISOString(), collectionCode: '', participant: p };
            pending.current.set(p.id, env);
          }
          for (const env of pending.current.values()) sendEnvelope(env);
          setNotice('전송 대기 자료를 확인합니다. 참여자별 저장 상태는 참여자 관리에서 확인하세요.');
        }} />}
        <footer className="page-footer"><span>FOCUS LAB <span className="footer-separator">/</span> HF·EF RESEARCH</span><span>실명 미수집 · 연구자 감독하에 사용</span></footer>
      </main>
    </div>
    {newModal && <NewParticipant existing={participants} onClose={() => setNewModal(false)} onCreate={p => { persist(p); setSelectedId(p.id); setNewModal(false); navigate('experiment'); }} />}
    {survey && selected && <Survey key={survey.id} step={survey} code={selected.code} onSubmit={(values, started) => finishStep(survey, values, started)} onClose={() => setSurvey(null)} />}
  </>;
}

function Welcome({ onNew, onSettings, onProtocol }: { onNew: () => void; onSettings: () => void; onProtocol: () => void }) {
  return <>
    <div className="welcome-grid">
      <section className="welcome-panel">
        <div className="panel-top"><Tag accent>실험 준비</Tag><span className="small muted">PROTOCOL V2</span></div>
        <h2>정확한 기록은<br />잘 정리된 절차에서 시작됩니다.</h2>
        <p>참여자와 순서군을 등록하면 실험 단계에 맞춰<br className="desktop-only" /> 기록 입력과 설문이 순서대로 안내됩니다.</p>
        <Button onClick={onNew} testId="button-start-first">첫 참여자 등록하기<ArrowRight size={18} /></Button>
        <div className="study-facts"><div><span>실험 설계</span><strong>2 × 2 반복측정</strong></div><div><span>참여자별 방문</span><strong>2회 <small>최소 48시간 간격</small></strong></div><div><span>전체 점프</span><strong>10회 <small>사전기록 포함</small></strong></div></div>
      </section>
      <section className="measurements-panel panel"><div className="section-title"><h2>측정 항목</h2><span className="eyebrow">MEASURES</span></div>
        {[['01', 'MRF-3', '인지불안 · 신체불안 · 자기확신', '1–11'], ['02', '주의초점 집중도', '처치 준수도 · 내적초점 관여', '0–100'], ['03', '평가압박 지각', '각 압박 세션 종료 직후', '1–7'], ['04', '제자리멀리뛰기', '시행별 기록 · 조건별 최고/평균', 'cm']].map(([n, title, desc, scale]) => <div className="measure-row" key={n}><span className="measure-index">{n}</span><div><strong>{title}</strong><p>{desc}</p></div><span className="measure-scale">{scale}</span></div>)}
      </section>
    </div>
    <section className="panel overview"><div className="section-title"><h2>실험 절차 한눈에 보기</h2><button className="inline-link" onClick={onProtocol}>전체 프로토콜<ArrowRight size={16} /></button></div><div className="overview-steps">{[['01', '참여자 등록', '동의·참여 기준 확인'], ['02', '사전 측정', '워밍업 + 무지시 2회'], ['03', '1차 세션', 'MRF-3 → 2개 초점 블록'], ['04', '2차 세션', '48시간 이후 반대 압박'], ['05', '완료·내보내기', '원자료와 조건별 요약']].map(([num, title, desc]) => <div key={num}><span>{num}</span><strong>{title}</strong><p>{desc}</p></div>)}</div></section>
    <button className="connect-callout" onClick={onSettings}><Link2 size={23} /><div><strong>측정 결과를 Google Sheets에 모아보세요.</strong><span>Apps Script를 연결하면 단계가 끝날 때마다 자동으로 전송할 수 있습니다.</span></div><span className="inline-link">연결 설정<ArrowRight size={17} /></span></button>
  </>;
}

function NewParticipant({ existing, onCreate, onClose }: { existing: Participant[]; onCreate: (p: Participant) => void; onClose: () => void }) {
  const [code, setCode] = useState(''), [group, setGroup] = useState<Group | ''>(''), [researcher, setResearcher] = useState(''), [demo, setDemo] = useState(false);
  const [checks, setChecks] = useState([false, false, false]), [error, setError] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,30}$/.test(clean)) return setError('참여자 코드는 영문, 숫자, - 및 _만 사용할 수 있습니다.');
    if (existing.some(p => p.code === clean && p.isDemo === demo)) return setError('같은 코드의 참여자가 이미 있습니다.');
    if (!group) return setError('사전 배정표에 따른 순서군을 선택하세요.');
    if (!checks.every(Boolean)) return setError('연구자 확인 항목을 모두 확인하세요.');
    onCreate({ id: crypto.randomUUID(), code: clean, group, isDemo: demo, researcher: researcher.trim(), createdAt: new Date().toISOString(), consentConfirmed: true, eligibilityConfirmed: true, protocolReviewed: true, stepIndex: 0, status: 'active', responses: [], notes: '' });
  }
  return <dialog ref={ref} className="modal" onCancel={e => { e.preventDefault(); onClose(); }}><div className="modal-header"><div><span className="eyebrow">NEW PARTICIPANT</span><h2>새 참여자 등록</h2></div><button className="icon-button" onClick={onClose} aria-label="등록 창 닫기"><X size={21} /></button></div><form onSubmit={submit}>
    <p className="muted">실명 대신 연구용 참여자 코드를 입력하세요. 순서군은 사전에 작성한 배정표를 따릅니다.</p>
    <div className="form-row"><label>참여자 코드<input autoFocus data-testid="input-participant-code" value={code} onChange={e => setCode(e.target.value)} placeholder="예: P001" maxLength={30} required autoComplete="off" /></label><label>연구자 코드 <span className="muted small">(선택)</span><input value={researcher} onChange={e => setResearcher(e.target.value)} placeholder="예: R01" maxLength={60} autoComplete="off" /></label></div>
    <fieldset className="group-field"><legend>순서군 선택</legend><div className="group-options">{(['A', 'B', 'C', 'D'] as Group[]).map(g => <label key={g} className={`group-choice ${group === g ? 'chosen' : ''}`}><input type="radio" name="group" value={g} checked={group === g} data-testid={`radio-group-${g}`} onChange={() => setGroup(g)} /><strong>{g}</strong><span>1차 {sessionDescription(g, 1)}<br />2차 {sessionDescription(g, 2)}</span></label>)}</div></fieldset>
    <label className="check-line demo-check"><input type="checkbox" data-testid="checkbox-demo" checked={demo} onChange={e => setDemo(e.target.checked)} /><span><strong>연습용 참여자로 등록</strong><small>실제 참여자를 사용하지 않고 화면을 점검합니다. Sheets 전송과 기본 CSV 분석에서 제외됩니다.</small></span></label>
    <div className="checklist"><h3>연구자 확인</h3>{['연구 설명 및 자발적 동의를 확인했습니다. 미성년자는 승인된 보호자 동의 절차를 따릅니다.', '현재 점프 수행을 제한하는 부상·통증이 없고 참여 기준을 충족합니다.', '설문 문구·척도와 압박 조작을 검토했습니다. 실제 수집은 승인된 연구계획에 따라 진행합니다.'].map((label, i) => <label className="check-line" key={label}><input type="checkbox" data-testid={`checkbox-intake-${i}`} checked={checks[i]} onChange={e => setChecks(x => x.map((v, j) => i === j ? e.target.checked : v))} /><span>{demo ? '[연습] ' : ''}{label}</span></label>)}</div>
    {error && <div className="error-text" role="alert">{error}</div>}<div className="modal-actions"><Button secondary onClick={onClose}>취소</Button><Button type="submit" testId="button-create-participant">등록하고 시작<ArrowRight size={17} /></Button></div>
  </form></dialog>;
}

function Procedure({ participant: p }: { participant: Participant }) {
  const steps = buildSteps(p.group), current = steps[p.stepIndex], completed = p.responses.length, percent = Math.round(completed / (steps.length - 1) * 100);
  return <aside className="procedure panel"><div className="section-title"><h2>진행 순서</h2><span className="small number">{percent}%</span></div><div className="progress-track"><div style={{ width: `${percent}%` }} /></div><div className="visit-plan">{[0, 1, 2].map(visit => <details key={visit} open={current.visit === visit || (visit === 2 && p.status === 'completed')}><summary><span>{visit === 0 ? '사전 준비' : `${visit}차 세션`}</span>{visit > 0 && <small>{sessionDescription(p.group, visit)}</small>}</summary><ol>{steps.filter(s => s.visit === visit && s.kind !== 'complete').map(s => { const i = steps.indexOf(s); return <li className={i === p.stepIndex ? 'current' : i < p.stepIndex ? 'done' : ''} key={s.id}><span className="step-dot">{i < p.stepIndex ? <Check size={11} /> : ''}</span><span>{s.label}</span>{i === p.stepIndex && <span className="current-marker">현재</span>}</li>; })}</ol></details>)}</div><div className="procedure-note"><ShieldCheck size={17} /><p>측정 순서는 건너뛸 수 없습니다.<br />결측·절차 위반은 사유와 함께 기록합니다.</p></div></aside>;
}

function StepPanel({ participant: p, step, onFinish, onSurvey, onBackup, onData }: { participant: Participant; step: Step; onFinish: (s: Step, v: Record<string, unknown>, started: string, missing?: string) => void; onSurvey: (s: Step) => void; onBackup: () => void; onData: () => void }) {
  const [started] = useState(() => new Date().toISOString());
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const complete = (values: Record<string, unknown> = {}) => onFinish(step, values, started);
  const checklist = (items: string[]) => <div className="step-checklist">{items.map(item => <label className="check-line" key={item}><input type="checkbox" data-testid={`check-step-${items.indexOf(item)}`} checked={!!checked[item]} onChange={e => setChecked(s => ({ ...s, [item]: e.target.checked }))} /><span>{item}</span></label>)}</div>;
  const count = Object.values(checked).filter(Boolean).length;
  const stepTitle = step.kind === 'complete' ? '모든 측정이 끝났습니다.' : step.kind === 'mrf' ? '수행 전, 현재 상태를 확인합니다.' : step.kind === 'focus' ? '방금 점프에서 어디에 집중했나요?' : step.kind === 'pressure' ? '이번 세션의 평가압박을 확인합니다.' : step.label;
  let content: React.ReactNode;
  if (step.kind === 'prep') {
    const items = ['연구계획에 따른 워밍업을 완료했습니다.', 'HF 지시를 듣고 참여자가 주의 대상을 본인의 말로 설명했습니다.', 'EF 지시를 듣고 참여자가 주의 대상을 본인의 말로 설명했습니다.'];
    content = <><p>두 지시를 각각 한 번 안내하고 이해 여부를 확인합니다. 이후 사전기록은 주의초점 지시 없이 2회 측정하세요.</p><div className="cue-pair">{(['HF', 'EF'] as const).map(f => <div key={f}><Tag>{f}</Tag><p>{CUES[f].instruction}</p><strong>“{CUES[f].cue}”</strong></div>)}</div><div className="inset"><span className="small muted">이해 확인 질문</span><p>“방금 들은 지시에서 점프할 때 무엇에 집중해야 하는지 본인의 말로 설명해 주세요.”</p></div>{checklist(items)}<Button disabled={count !== 3} onClick={() => complete({ warmup: true, hf_teachback: true, ef_teachback: true })} testId="button-step-next">준비 완료 · 사전 측정으로<ArrowRight size={17} /></Button></>;
  } else if (step.kind === 'baseline' || step.kind === 'jump') {
    content = <TrialForm step={step} onSubmit={complete} />;
  } else if (step.kind === 'intro') {
    const high = step.pressure === 'high';
    const items = high ? ['별도 모의실기 평가 장소와 연구자 외 평가자 2명을 확인했습니다.', '참가번호 호명·시작 신호·촬영 안내·개인 기록 제공 절차를 안내했습니다.', '성과 보상은 IRB 승인 사항에만 따라 적용하며, 미승인 보상을 약속하지 않았습니다.'] : ['사전기록 측정과 동일 장소이며 연구자 1명이 진행합니다.', '일반 수행 측정·연구 목적 촬영·기록 비공개·성과 보상 없음을 안내했습니다.'];
    content = <><p>{high ? '승인된 모의실기 평가 안내문을 사용하세요. 실제 평가자 배치와 환경을 확인한 후, 점프 전에 MRF-3를 실시합니다.' : '일반 수행 측정 환경을 안내하세요. 조건 안내를 마친 후, 점프 전에 MRF-3를 실시합니다.'}</p><div className="condition-banner"><strong>{PRESSURE_LABEL[step.pressure!]} 조건</strong><span>{sessionDescription(p.group, step.visit)}</span></div>{step.visit === 2 && <Banner>2차 방문 워밍업의 실시 여부·방식은 승인된 연구계획에 따라 통일하세요.</Banner>}{checklist(items)}<Button testId="button-step-next" disabled={count !== items.length} onClick={() => complete({ pressure_setup_confirmed: true })}>안내 완료 · MRF-3로<ArrowRight size={17} /></Button></>;
  } else if (step.kind === 'mrf' || step.kind === 'focus' || step.kind === 'pressure') {
    const isMrf = step.kind === 'mrf', isFocus = step.kind === 'focus';
    const questions = isMrf ? MRF_QUESTIONS : isFocus ? focusQuestions(step.focus!) : [PRESSURE_QUESTION];
    content = <><p>태블릿을 참여자에게 건네주세요. 참여자 화면에는 한 번에 한 문항만 표시되며, 이전 기록이나 다른 조건은 보이지 않습니다.</p><div className="survey-preview"><span className="eyebrow">PARTICIPANT QUESTIONNAIRE</span><h3>{isMrf ? '현재 상태 설문' : isFocus ? '주의초점 집중도 설문' : '평가압박 지각 설문'}</h3><div className="survey-meta"><span>{questions.length}문항</span><span>{isFocus ? '0–100 VAS' : isMrf ? '1–11점 척도' : '1–7점 척도'}</span><span>전체 응답 확인 후 제출</span></div><Button onClick={() => onSurvey(step)} testId="button-open-survey"><Maximize2 size={18} />참여자 설문 시작</Button></div><p className="small muted">문항은 PPT 기준 한국어 초안입니다. 본 조사 전에 연구책임자가 표현과 척도 사용을 확정하세요.</p><details className="missing-option"><summary>설문을 실시할 수 없나요?</summary><p>응답 거부 등으로 측정하지 못한 경우입니다. 모든 문항은 결측으로 남으며, 0점으로 대체되지 않습니다.</p><label>결측 사유<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="예: 참여자가 설문 응답을 거부함" /></label><Button secondary disabled={!reason.trim()} onClick={() => onFinish(step, { ...Object.fromEntries(questions.map(q => [q.key, null])), question_version: QUESTION_VERSION }, started, reason.trim())}>결측으로 기록하고 계속</Button></details></>;
  } else if (step.kind === 'cue') {
    content = <><div className="focus-instruction"><Tag accent>{step.focus} · {FOCUS_LABEL[step.focus!]}</Tag><h3>“{CUES[step.focus!].instruction}”</h3><span className="small muted">단서어</span><strong className="cue-word">{CUES[step.focus!].cue}</strong></div>{step.focus === 'EF' && <p className="small muted">주황색 콘 1개를 출발선 전방 5m 위치에 설치합니다.</p>}<h3 className="spaced-title">매 점프 직전 공통 루틴</h3><ol className="routine">{['발 위치를 시작선에 정렬', '심호흡 1회', '준비 자세', '해당 단서어 1회', '3초 이내 점프'].map((r, i) => <li key={r}><span>{i + 1}</span>{r}</li>)}</ol>{checklist(['주의초점 지시와 시행 전 루틴을 안내했습니다.'])}<Button testId="button-step-next" disabled={count !== 1} onClick={() => complete({ cue: CUES[step.focus!].cue, instruction_confirmed: true })}>안내 완료 · 점프 기록<ArrowRight size={17} /></Button></>;
  } else if (step.kind === 'rest') {
    content = <RestTimer onSubmit={complete} />;
  } else if (step.kind === 'visitEnd') {
    content = <><div className="completion-symbol"><CheckCircle2 size={44} /></div><p>{step.visit}차 세션의 측정이 끝났습니다. 다음 단계로 넘어가기 전에 JSON 백업 파일을 저장하고 다운로드 여부를 확인하세요.</p><div className="inset"><strong>{step.visit === 1 ? '2차 세션은 최소 48시간 후 진행합니다.' : '두 방문의 자료를 함께 보관하세요.'}</strong><p>{step.visit === 1 ? '다른 기기에서 재개할 때는 이 백업 파일을 불러오면 됩니다.' : 'CSV는 분석용, JSON은 복원용입니다. 둘 다 비공개 연구 폴더에 저장하세요.'}</p></div><Button secondary onClick={onBackup} testId="button-session-backup"><Download size={18} />JSON 백업 다운로드</Button>{checklist(['백업 파일이 기기에 저장되었거나 승인된 보관소에 보관된 것을 확인했습니다.'])}<Button testId="button-step-next" disabled={count !== 1} onClick={() => complete({ backup_confirmed: true })}>{step.visit === 1 ? '1차 세션 종료' : '전체 실험 완료'}<ArrowRight size={17} /></Button><p className="small muted">종료 확인도 새로운 기록입니다. 종료 버튼을 누른 뒤 최종 백업을 한 번 더 저장하세요.</p></>;
  } else if (step.kind === 'interval') {
    const end = p.responses.find(r => r.stepId === 'v1-end')?.completedAt;
    const elapsed = end ? (Date.now() - new Date(end).getTime()) / 3600000 : 0;
    const allowed = elapsed >= 48;
    content = <><p>1차 세션 종료 시점을 기준으로 방문 간격을 확인합니다. 시스템 시간 오류 또는 예외 진행은 반드시 사유를 남기세요.</p><div className="interval-grid"><div><span>1차 세션 종료 (KST)</span><strong>{end ? localDate(end) : '기록 없음'}</strong></div><div><span>현재 경과 시간</span><strong>{elapsed.toFixed(1)}시간 <small>/ 최소 48시간</small></strong></div></div>{!allowed && <Banner warning>아직 최소 방문 간격에 도달하지 않았습니다. 원칙적으로 {end ? localDate(new Date(new Date(end).getTime() + 48 * 3600000).toISOString()) : '48시간 이후'}부터 재개하세요.</Banner>}{!allowed && <label className="spaced-title">예외 진행 사유 (조기 재개 시 필수)<textarea data-testid="input-interval-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="연습 진행 또는 승인된 절차 위반 사유" maxLength={500} /></label>}{checklist(['참여 지속 의사와 당일 수행 가능 여부를 다시 확인했습니다.'])}<Button testId="button-step-next" disabled={count !== 1 || (!allowed && !reason.trim())} onClick={() => complete({ elapsed_hours: Math.round(elapsed * 100) / 100, minimum_hours: 48, protocol_deviation: !allowed, deviation_reason: allowed ? '' : reason.trim(), eligibility_reconfirmed: true })}>2차 세션 재개<ArrowRight size={17} /></Button></>;
  } else {
    const s = summarize(p);
    content = <><div className="completion-symbol"><CheckCircle2 size={48} /></div><p>두 세션의 측정이 완료되었습니다. 원자료를 백업하고 결측·절차 위반 여부를 확인하세요.</p><div className="result-strip"><div><span>고압박 HF 최고</span><strong>{fmt(s.highHF.best)} <small>cm</small></strong></div><div><span>고압박 EF 최고</span><strong>{fmt(s.highEF.best)} <small>cm</small></strong></div><div><span>HF − EF</span><strong>{fmt(s.highDifference)} <small>cm</small></strong></div></div><Banner>개인별 차이는 기술통계입니다. 이 화면은 비열등성 여부를 판정하지 않습니다.</Banner><div className="button-row"><Button onClick={onBackup}><Download size={17} />최종 JSON 백업</Button><Button secondary onClick={onData}>측정 데이터 보기<ArrowRight size={17} /></Button></div></>;
  }
  return <section className="panel step-panel"><div className="step-heading"><span className="eyebrow">{step.visit ? `VISIT ${String(step.visit).padStart(2, '0')}` : 'PREPARATION'} <span className="slash">/</span> {step.kind === 'complete' ? 'COMPLETE' : 'RESEARCHER VIEW'}</span><div>{step.pressure && <Tag>{PRESSURE_LABEL[step.pressure]}</Tag>}{step.focus && <Tag accent>{step.focus}</Tag>}</div></div><h2>{stepTitle}</h2>{content}</section>;
}

function TrialForm({ step, onSubmit }: { step: Step; onSubmit: (v: Record<string, unknown>) => void }) {
  const [distance, setDistance] = useState(''), [validity, setValidity] = useState('valid'), [reason, setReason] = useState('');
  const validNumber = distance !== '' && Number.isFinite(Number(distance)) && Number(distance) > 0 && Number(distance) <= 500 && /^\d+(\.\d)?$/.test(distance);
  return <form onSubmit={e => { e.preventDefault(); if (validity === 'valid' ? !validNumber : !reason.trim()) return; onSubmit({ distance: validity === 'valid' ? Number(distance) : null, validity, reason: validity === 'valid' ? '' : reason.trim(), unit: 'cm' }); }}>
    <p>{step.kind === 'baseline' ? '주의초점 지시 없이 측정한 기록을 입력하세요.' : `해당 단서어 “${CUES[step.focus!].cue}”와 공통 루틴 적용 후 ${step.trial}번째 기록을 입력하세요.`} 기록 입력은 연구자가 진행합니다.</p>
    <div className="trial-label"><Tag accent>{step.trial} / 2 시행</Tag><span className="small muted">측정 단위: cm</span></div>
    <fieldset className="validity-field"><legend className="sr-only">시행 상태</legend>{[['valid', '유효'], ['foul', '파울 / 무효'], ['missing', '미실시 / 결측']].map(([v, label]) => <label key={v} className={validity === v ? 'chosen' : ''}><input name="validity" type="radio" checked={validity === v} onChange={() => setValidity(v)} />{label}</label>)}</fieldset>
    {validity === 'valid' ? <label className="distance-label">점프 기록<div className="distance-input"><input data-testid="input-distance" type="number" step="0.1" min="0.1" max="500" inputMode="decimal" autoComplete="off" value={distance} onChange={e => setDistance(e.target.value)} placeholder="0.0" required /><span>cm</span></div><small>실측값을 그대로 입력하세요. 최대 소수점 첫째 자리까지 입력할 수 있습니다.</small></label> : <label className="spaced-title">사유<textarea data-testid="input-trial-reason" required value={reason} onChange={e => setReason(e.target.value)} placeholder="예: 착지 후 뒤로 넘어져 무효 처리" maxLength={500} /><small>무효·미실시 시행은 0cm가 아닌 결측으로 저장합니다. 자동 재시행은 추가하지 않습니다.</small></label>}
    {validity === 'valid' && distance && !validNumber && <p role="alert" className="error-text">0cm 초과 500cm 이하, 소수점 한 자리 이내로 입력하세요.</p>}
    <Button testId="button-save-trial" type="submit" disabled={validity === 'valid' ? !validNumber : !reason.trim()}>기록 저장하고 계속<ArrowRight size={17} /></Button>
  </form>;
}

function RestTimer({ onSubmit }: { onSubmit: (v: Record<string, unknown>) => void }) {
  const [elapsed, setElapsed] = useState(0), [running, setRunning] = useState(false), [reason, setReason] = useState('');
  const base = useRef(0), start = useRef(0), firstStart = useRef('');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed(base.current + (Date.now() - start.current) / 1000), 200);
    return () => clearInterval(timer);
  }, [running]);
  function toggle() {
    if (running) { const now = base.current + (Date.now() - start.current) / 1000; base.current = now; setElapsed(now); setRunning(false); }
    else { start.current = Date.now(); if (!firstStart.current) firstStart.current = new Date().toISOString(); setRunning(true); }
  }
  const remaining = Math.max(0, Math.ceil(600 - elapsed));
  return <><p>첫 번째 주의초점 블록이 종료되었습니다. 10분간 휴식한 뒤 두 번째 블록을 진행하세요.</p><div className="timer-display" role="timer" aria-label={`남은 휴식 ${Math.floor(remaining / 60)}분 ${remaining % 60}초`}><span>{String(Math.floor(remaining / 60)).padStart(2, '0')}<span>:</span>{String(remaining % 60).padStart(2, '0')}</span><small>{elapsed >= 600 ? '휴식 시간이 충족되었습니다.' : running ? '휴식 진행 중' : elapsed ? '일시 정지됨' : '타이머를 시작하세요.'}</small></div><div className="button-row timer-actions"><Button secondary onClick={toggle} testId="button-timer-toggle">{running ? <Pause size={17} /> : <Play size={17} />}{running ? '일시 정지' : elapsed ? '이어서 시작' : '타이머 시작'}</Button></div><details className="missing-option"><summary>시간을 충족하지 않고 진행해야 하나요?</summary><p>조기 진행은 절차 위반으로 기록됩니다. 연습이나 불가피한 상황에서만 사용하세요.</p><label>조기 진행 사유<textarea data-testid="input-rest-reason" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="사유를 입력하세요." /></label></details><Button testId="button-step-next" disabled={elapsed < 600 && !reason.trim()} onClick={() => { const actual = running ? base.current + (Date.now() - start.current) / 1000 : elapsed; onSubmit({ rest_seconds: Math.floor(actual), planned_seconds: 600, timer_started_at: firstStart.current || null, protocol_deviation: actual < 600, deviation_reason: actual < 600 ? reason.trim() : '' }); }}>휴식 종료 · 다음 블록<ArrowRight size={17} /></Button></>;
}

function Survey({ step, code, onSubmit, onClose }: { step: Step; code: string; onSubmit: (v: Record<string, unknown>, started: string) => void; onClose: () => void }) {
  const questions = step.kind === 'mrf' ? MRF_QUESTIONS : step.kind === 'focus' ? focusQuestions(step.focus!) : [PRESSURE_QUESTION];
  const [index, setIndex] = useState(0), [answers, setAnswers] = useState<Record<string, number>>({}), [methods, setMethods] = useState<Record<string, string>>({});
  const [started] = useState(() => new Date().toISOString());
  const [times, setTimes] = useState<Record<string, { answeredAt: string }>>({});
  const [exit, setExit] = useState(false);
  const q = questions[index], answer = answers[q.key];
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => { document.getElementById('question-title')?.focus(); }, [index]);
  function set(value: number, method: string) { setAnswers(a => ({ ...a, [q.key]: value })); setMethods(a => ({ ...a, [q.key]: method })); setTimes(t => ({ ...t, [q.key]: { answeredAt: new Date().toISOString() } })); }
  function forward() {
    if (answer === undefined) return;
    if (index < questions.length - 1) setIndex(index + 1);
    else onSubmit({ ...answers, question_version: QUESTION_VERSION, response_time_ms: Date.now() - Date.parse(started), response_methods: methods, item_timestamps: times }, started);
  }
  return <dialog ref={ref} className="survey-dialog" onCancel={e => { e.preventDefault(); setExit(true); }}><div className="survey-shell">
    <header className="survey-header"><Logo /><span className="survey-participant">참여자 <strong>{code}</strong></span><button className="text-button" onClick={() => setExit(true)} data-testid="button-exit-survey">연구자에게 돌려주기<X size={17} /></button></header>
    <main className="survey-main"><div className="survey-progress-label"><span>{step.kind === 'mrf' ? '현재 상태' : step.kind === 'focus' ? '주의집중 경험' : '수행 경험'}</span><span>{String(index + 1).padStart(2, '0')} <span className="muted">/ {String(questions.length).padStart(2, '0')}</span></span></div><div className="survey-progress-track"><span style={{ width: `${(index + 1) / questions.length * 100}%` }} /></div>
      <div className="question-heading"><span className="eyebrow">QUESTION {String(index + 1).padStart(2, '0')}</span><h1 id="question-title" tabIndex={-1}>{q.title}</h1><p>{q.type === 'vas' ? '현재 느낌에 가장 가까운 위치를 눌러 주세요. 정답이나 오답은 없습니다.' : '현재 느낌에 가장 가까운 숫자 하나를 선택해 주세요.'}</p></div>
      {q.type === 'scale' ? <fieldset className="scale-field"><legend className="sr-only">{q.title}</legend><div className={`scale-options scale-${q.max}`}>{Array.from({ length: q.max }, (_, i) => i + 1).map(n => <label key={n} className={`scale-choice ${answer === n ? 'selected' : ''}`}><input data-testid={`scale-${n}`} type="radio" name={q.key} value={n} checked={answer === n} onChange={() => set(n, 'radio')} aria-label={`${n}점${n === 1 ? ` ${q.low}` : n === q.max ? ` ${q.high}` : ''}`} /><span>{n}</span></label>)}</div><div className="scale-anchors"><span><strong>{q.min}</strong>{q.low}</span><span>{q.high}<strong>{q.max}</strong></span></div></fieldset> :
      <div className={`vas-field ${answer === undefined ? 'unanswered' : ''}`}><div className="vas-value">{answer === undefined ? <span className="unanswered-text">아직 응답하지 않았습니다</span> : <><strong>{answer}</strong><span> / 100</span></>}</div><label className="sr-only" htmlFor="vas-range">{q.title}</label><input id="vas-range" data-testid="input-vas-range" type="range" min={0} max={100} step={1} value={answer ?? 50} onChange={e => set(Number(e.target.value), 'range')} onPointerUp={e => { if (answer === undefined) set(Number(e.currentTarget.value), 'range'); }} onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(e.key)) set(Number(e.currentTarget.value), 'keyboard'); }} aria-valuetext={answer === undefined ? '미응답, 직접 위치를 선택하세요' : `${answer}점`} /><div className="scale-anchors"><span><strong>0</strong>{q.low}</span><span>{q.high}<strong>100</strong></span></div><label className="numeric-alternative">숫자로 직접 입력 <input aria-label="집중도 숫자 입력" data-testid="input-vas-number" type="number" inputMode="numeric" min={0} max={100} step={1} placeholder="0–100" value={answer ?? ''} onChange={e => { if (e.target.value === '') { setAnswers(a => { const b = { ...a }; delete b[q.key]; return b; }); } else { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= 100) set(n, 'numeric'); } }} /></label></div>}
      <div className="survey-bottom"><button className="text-button" disabled={index === 0} onClick={() => setIndex(index - 1)} data-testid="button-survey-prev"><ArrowLeft size={17} />이전 문항</button><span className="selected-answer" aria-live="polite">{answer === undefined ? '응답을 선택하면 계속할 수 있어요.' : `${answer}점 선택됨`}</span><Button disabled={answer === undefined} onClick={forward} testId="button-survey-next">{index === questions.length - 1 ? '응답 제출' : '다음 문항'}<ArrowRight size={18} /></Button></div>
    </main>
    <footer className="survey-footer"><ShieldCheck size={15} />응답은 연구 목적으로만 사용됩니다. 참여를 원치 않으면 연구자에게 알려주세요.</footer>
    {exit && <div className="exit-overlay"><section className="exit-confirm" role="alertdialog" aria-labelledby="exit-title"><h2 id="exit-title">연구자 화면으로 돌아갈까요?</h2><p>아직 제출하지 않은 이 설문의 응답은 저장되지 않습니다. 측정은 현재 단계에 머무릅니다.</p><div className="button-row"><Button secondary onClick={() => setExit(false)}>계속 응답하기</Button><Button onClick={onClose}>돌아가기</Button></div></section></div>}
  </div></dialog>;
}

function SaveBadge({ status }: { status?: SaveStatus }) {
  return <span className={`save-badge ${status?.state === 'synced' ? 'confirmed' : status?.state === 'error' ? 'failed' : ''}`} title={status?.text}><span className="status-dot" />{status?.state === 'synced' ? 'Sheets 저장 확인' : status?.state === 'sending' ? '전송 중' : status?.state === 'error' ? '저장 미확인 · 재전송 필요' : '임시 보관 · 미전송'}</span>;
}
function ParticipantList({ participants, selectedId, statuses, onSelect, onNew, onBackup }: { participants: Participant[]; selectedId: string | null; statuses: Record<string, SaveStatus>; onSelect: (p: Participant) => void; onNew: () => void; onBackup: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = participants.filter(p => p.code.toLowerCase().includes(search.toLowerCase()));
  return <section className="panel"><div className="section-title"><h2>현재 불러온 참여자 <span className="muted">{participants.length}</span></h2><Button secondary disabled={!participants.length} onClick={onBackup}><Download size={16} />전체 백업</Button></div><label className="search-label"><span className="sr-only">참여자 코드 검색</span><input placeholder="참여자 코드 검색" data-testid="input-search-participant" value={search} onChange={e => setSearch(e.target.value)} /></label>
    {!participants.length ? <Empty title="첫 참여자를 등록해 주세요." text="새 참여자를 등록하거나 기존 JSON 백업을 불러오면 이곳에 표시됩니다." action={<Button onClick={onNew}><Plus size={17} />새 참여자 등록</Button>} /> : <div className="table-scroll"><table><thead><tr><th>참여자 코드</th><th>순서군</th><th>진행 상황</th><th>저장 상태</th><th>열기</th></tr></thead><tbody>{filtered.map(p => <tr key={p.id} className={p.id === selectedId ? 'selected-row' : ''}><td><strong>{p.code}</strong>{p.isDemo && <Tag>연습</Tag>}</td><td>{p.group}군</td><td>{p.status === 'completed' ? '전체 완료' : p.status === 'withdrawn' ? '중단' : buildSteps(p.group)[p.stepIndex].label}<small>{p.responses.length}개 단계 기록</small></td><td>{p.isDemo ? <span className="muted small">전송 제외</span> : <SaveBadge status={statuses[p.id]} />}</td><td><button className="text-button" data-testid={`open-${p.code}`} onClick={() => onSelect(p)}>열기<ArrowRight size={16} /></button></td></tr>)}</tbody></table>{!filtered.length && <p className="inset muted">검색 결과가 없습니다.</p>}</div>}
  </section>;
}
function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) { return <div className="empty-state"><Table2 size={35} strokeWidth={1.2} /><h3>{title}</h3><p>{text}</p>{action}</div>; }
function DataView({ participants, onBackup }: { participants: Participant[]; onBackup: () => void }) {
  const [includeDemo, setIncludeDemo] = useState(false), [tab, setTab] = useState<'conditions' | 'responses'>('conditions');
  const list = participants.filter(p => includeDemo || !p.isDemo);
  const [pid, setPid] = useState('');
  const selected = list.find(p => p.id === pid) || list[0];
  return <><div className="data-toolbar"><label className="check-line"><input type="checkbox" data-testid="checkbox-include-demo" checked={includeDemo} onChange={e => setIncludeDemo(e.target.checked)} />연습 데이터 포함</label><span className="small muted">현재 {list.length}명 · 서버 전체 조회가 아닙니다.</span><div className="button-row"><Button secondary disabled={!list.length} onClick={() => exportCSV(list, 'participants')}>참여자 CSV<Download size={16} /></Button><Button secondary disabled={!list.length} onClick={() => exportCSV(list, 'conditions')}>조건별 CSV<Download size={16} /></Button><Button disabled={!list.some(p => p.responses.length)} onClick={() => exportCSV(list, 'responses')}>원자료 CSV<Download size={16} /></Button></div></div>
    <section className="panel"><div className="data-tabs"><button className={tab === 'conditions' ? 'active' : ''} onClick={() => setTab('conditions')}>조건별 수행 요약</button><button className={tab === 'responses' ? 'active' : ''} onClick={() => setTab('responses')}>단계별 원자료</button></div>{!list.length ? <Empty title="아직 측정 데이터가 없습니다." text="실험 단계를 완료하면 응답이 쌓입니다. 연습 자료를 보려면 위의 ‘연습 데이터 포함’을 선택하세요." /> : tab === 'conditions' ? <div className="table-scroll"><table><thead><tr><th>참여자</th><th>사전 최고</th><th>저압박 HF</th><th>저압박 EF</th><th>고압박 HF</th><th>고압박 EF</th><th>고압박 HF−EF</th></tr></thead><tbody>{list.map(p => { const s = summarize(p); return <tr key={p.id}><td><strong>{p.code}</strong><small>{p.group}군{p.isDemo ? ' · 연습' : ''}{p.status === 'withdrawn' ? ' · 중단' : ''}</small></td>{[s.baseline, s.lowHF, s.lowEF, s.highHF, s.highEF].map((v, i) => <td key={i}><strong className="number">{fmt(v.best)}</strong><small>평균 {fmt(v.mean)} · 유효 {v.validN}/2</small></td>)}<td className="accent-text number">{fmt(s.highDifference)}<small>cm</small></td></tr>; })}</tbody></table></div> : <><label className="select-participant">참여자<select value={selected?.id || ''} onChange={e => setPid(e.target.value)}>{list.map(p => <option value={p.id} key={p.id}>{p.code} · {p.group}군</option>)}</select></label><div className="response-list">{selected?.responses.length ? selected.responses.map(r => <details key={r.stepId}><summary><span><Tag>{r.visit ? `${r.visit}차` : '사전'}</Tag><strong>{buildSteps(selected.group).find(s => s.id === r.stepId)?.label}</strong></span><small>{localDate(r.completedAt)} KST</small></summary><dl>{Object.entries(r.values).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v === null ? '결측' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>)}{r.missingReason && <div><dt>결측 사유</dt><dd>{r.missingReason}</dd></div>}</dl></details>) : <Empty title="아직 완료한 단계가 없습니다." text="실험 진행 화면에서 측정을 시작하세요." />}</div></>}
    </section><div className="data-notes"><Banner>최고·평균은 유효 시행만으로 계산합니다. 유효 시행이 1회인 조건은 불완전 자료로 구분하여 검토하세요. 중단 참여자도 원자료 보존을 위해 포함됩니다.</Banner><p className="small muted">1차 결과변수: 고압박 HF 최고 − 고압박 EF 최고. 개인별 차이만으로 비열등성을 판단하지 않습니다. JSON 백업은 복원용이며 CSV는 복원할 수 없습니다.</p><button className="text-button" onClick={onBackup} disabled={!participants.length}><FileJson size={17} />복원용 JSON 백업</button></div></>;
}

function ProtocolView() {
  const [n, setN] = useState('68'), [error, setError] = useState('');
  return <div className="protocol-page"><Banner warning>문항은 첨부 PPT의 개념 설명과 양끝점을 바탕으로 만든 한국어 초안입니다. 검증된 번역판으로 표시하지 않습니다. 본 조사 전 문구·시행 기준·IRB 승인 절차를 확정하세요.</Banner><section className="panel"><div className="section-title"><h2>설계와 측정 시점</h2><Tag>2 × 2 참가자 내</Tag></div><div className="table-scroll"><table><thead><tr><th>시점</th><th>측정 / 절차</th><th>척도·횟수</th><th>전체 횟수</th></tr></thead><tbody>{[['워밍업 이후', '무지시 사전 점프', '2회 · cm', '2회'], ['각 압박 세션 안내 후, 점프 전', 'MRF-3: 인지불안 / 신체불안 / 자기확신', '각 1–11점', '2세트 / 6응답'], ['각 HF·EF 블록', '제자리멀리뛰기', '조건당 2회 · cm', '8회'], ['각 HF·EF 블록 직후', '처치 준수도 / 내적초점 관여', '각 0–100 VAS', '4세트 / 8응답'], ['블록 사이', '휴식 타이머', '10분', '2회'], ['각 압박 세션 종료 직후', '평가압박 지각', '1–7점', '2응답']].map(r => <tr key={r[0]}>{r.map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody></table></div><p className="small muted">총 점프 10회, 총 설문 응답 16개. 추가 MRF-3 또는 사전 설문을 임의로 삽입하지 않았습니다.</p></section>
    <section className="panel"><h2>순서군 배정</h2><div className="table-scroll"><table><thead><tr><th>순서군</th><th>1차 방문</th><th>2차 방문 (최소 48시간 후)</th></tr></thead><tbody>{(['A', 'B', 'C', 'D'] as Group[]).map(g => <tr key={g}><td><Tag accent>{g}</Tag></td><td>{sessionDescription(g, 1)}</td><td>{sessionDescription(g, 2)}</td></tr>)}</tbody></table></div><div className="allocation"><div><h3>사전 균형 무작위 배정표</h3><p>4명 블록 내 A·B·C·D를 무작위로 섞은 CSV를 만듭니다. 연구자가 한 번 생성해 전체 태블릿에 공통 적용하세요. 반복 생성은 기존 배정을 덮어쓰지 않습니다.</p></div><label>모집 인원<input type="number" min={4} max={500} step={4} value={n} onChange={e => setN(e.target.value)} /></label><Button secondary onClick={() => { try { allocationCSV(Number(n)); setError(''); } catch (e) { setError((e as Error).message); } }}><Download size={16} />배정표 만들기</Button></div>{error && <p className="error-text">{error}</p>}<p className="small muted">단순 블록 무작위화 예시이며 층화·배정 은폐를 구현하지 않습니다. 인원과 무작위화 방식은 연구계획에 맞춰 확정하세요.</p></section>
    <section className="panel"><h2>문항 및 응답 방향</h2><div className="question-reference">{[...MRF_QUESTIONS, ...focusQuestions('HF').slice(0, 1), ...focusQuestions('EF'), PRESSURE_QUESTION].map((q, i) => <div key={`${q.key}-${i}`}><span className="small muted">{q.key} · {q.min}–{q.max}</span><strong>{q.title}</strong><p>{q.low} → {q.high}</p></div>)}</div><Banner>자기확신은 점수가 높을수록 자신감이 높습니다. 세 MRF-3 문항을 자동 합산하거나 자기확신을 자동 역채점하지 않습니다.</Banner><p className="small muted">VAS는 0–100의 정수 해상도로 저장합니다. 터치·키보드·숫자 입력 방식도 함께 기록합니다. 표준화된 디지털 척도로서의 사용 적합성은 본 조사 전에 확인하세요.</p></section><section className="panel"><h2>진행·보관 원칙</h2><ul className="plain-list"><li>연구자용 안내와 참가자용 설문을 분리합니다. 이는 인증 기능이 아니라 동일 태블릿의 화면 분리입니다.</li><li>무효·미실시·응답 거부는 사유와 함께 결측으로 남깁니다. 임의 재시행은 추가하지 않습니다.</li><li>최소 48시간 이전 방문·10분 미만 휴식은 사유와 실제 시간을 기록합니다.</li><li>원자료 수정·삭제는 제공하지 않습니다. 정정은 원자료를 보존하고 별도 연구 기록으로 관리하세요.</li><li>동의 체크는 연구자 확인 기록이며, 승인된 설명문·서면 동의서를 대체하지 않습니다.</li><li>실명·연락처·구체적인 의료정보는 수집하지 않습니다. 코드 대응표는 별도로 보관하세요.</li></ul><a className="inline-link" href="https://github.com/ckmzx/focus-jump-lab/blob/main/docs/MEASUREMENT_GUIDE.md" target="_blank" rel="noreferrer">연구자 측정 안내 보기<ExternalLink size={16} /></a></section>
  </div>;
}

function SettingsView({ value, onChange, pendingCount, onRetry }: { value: Connection; onChange: (v: Connection) => void; pendingCount: number; onRetry: () => void }) {
  const [url, setUrl] = useState(value.url), [code, setCode] = useState(value.code), [message, setMessage] = useState(''), [consent, setConsent] = useState(value.auto);
  const validUrl = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.trim());
  return <div className="settings-grid"><section className="panel"><div className="section-title"><h2>Google Sheets 연결</h2><Tag accent>{value.auto ? '자동 전송 켜짐' : '설정 필요'}</Tag></div><p>새 스프레드시트에 제공된 Apps Script를 설치한 뒤 웹앱 주소를 입력하세요. 설정값은 현재 탭에서만 유지되며, JSON 백업에는 포함되지 않습니다.</p><ol className="setup-list"><li><span>1</span><div><strong>시트에 수신 코드 설치</strong><p>확장 프로그램 → Apps Script에서 Code.gs를 붙여 넣고 초기 설정을 실행합니다.</p><a href="https://github.com/ckmzx/focus-jump-lab/blob/main/apps-script/Code.gs" target="_blank" rel="noreferrer" className="inline-link">Code.gs 열기<ExternalLink size={15} /></a></div></li><li><span>2</span><div><strong>웹앱으로 배포</strong><p>실행 사용자: 나 · 액세스: 모든 사용자. 시트 자체는 비공개로 유지합니다.</p></div></li><li><span>3</span><div><strong>아래에 연결 정보 입력</strong><p>스크립트 속성의 COLLECTION_CODE와 동일한 수집 코드를 사용합니다.</p></div></li></ol>
    <form onSubmit={e => { e.preventDefault(); if (!validUrl) return setMessage('https://script.google.com/macros/s/…/exec 형식의 배포 URL을 입력하세요.'); if (code.trim().length < 24 || code.trim().length > 128) return setMessage('수집 코드는 24~128자로 설정하세요.'); if (!consent) return setMessage('연구 데이터 전송 안내를 확인하세요.'); onChange({ url: url.trim(), code: code.trim(), auto: true }); setMessage('자동 전송을 켰습니다. 아직 저장 검증은 되지 않았습니다. 참여자 단계 완료 또는 대기 자료 재전송 후 Sheets 저장 확인 상태를 확인하세요.'); }}>
      <label>Apps Script 웹앱 URL<input data-testid="input-script-url" type="url" value={url} onChange={e => setUrl(e.target.value)} autoComplete="off" placeholder="https://script.google.com/macros/s/…/exec" /></label><label>수집 코드 (COLLECTION_CODE)<input data-testid="input-collection-code" type="password" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" placeholder="스크립트 속성에 설정한 24~128자 코드" maxLength={128} /></label><label className="check-line"><input type="checkbox" data-testid="checkbox-transmission" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>이 주소가 연구용 수신 시트임을 확인했으며 익명 코드·설문·수행 기록을 전송합니다. 보관 및 접근권한은 연구계획에 따릅니다.</span></label><div className="button-row"><Button type="submit" testId="button-enable-sheets"><Link2 size={17} />연결 정보 적용</Button><Button secondary disabled={!value.auto} onClick={() => { onChange({ ...value, auto: false }); setMessage('자동 전송을 껐습니다. 응답은 현재 화면에 임시 보관됩니다.'); }}>자동 전송 끄기</Button></div>
    </form>{message && <div className="inset" role="status">{message}</div>}
    <div className="retry-block"><strong>저장 대기·미확인 자료</strong><p>Google의 확인 응답을 받은 경우에만 저장 완료로 표시합니다. 네트워크·권한 문제로 확인되지 않으면 시트를 먼저 확인하고 재전송하세요. 복원한 실제 자료도 전송 대상으로 등록됩니다.</p><Button secondary disabled={!value.url || !value.code} onClick={onRetry}><RotateCcw size={16} />대기 자료 재전송{pendingCount > 0 ? ` (${pendingCount})` : ''}</Button></div>
  </section><aside className="settings-aside"><section className="panel"><ShieldCheck size={25} /><h2>응답을 안전하게 보관하세요.</h2><ul className="plain-list"><li>연구 응답은 GitHub에 올라가지 않습니다.</li><li>Google 시트는 링크 공개하지 마세요.</li><li>수집 코드는 소스 코드나 공개 URL에 넣지 마세요.</li><li>연습 참여자는 전송하지 않습니다.</li><li>태블릿을 잠그고 승인된 연구자가 관리하세요.</li></ul></section><section className="panel"><FileJson size={24} /><h2>연결 전에도 사용할 수 있어요.</h2><p>현재 탭에서 측정한 뒤 JSON과 CSV로 내보낼 수 있습니다. 브라우저를 닫거나 새로고침하면 임시 데이터가 사라집니다.</p><p className="small muted">Sheets는 수신 전용입니다. 다음 방문을 재개하려면 JSON 백업을 불러오세요. 여러 태블릿은 동일한 사전 배정표를 사용하세요.</p></section><a className="guide-link" href="https://github.com/ckmzx/focus-jump-lab/blob/main/apps-script/README.md" target="_blank" rel="noreferrer"><BookOpen size={19} />Google Sheets 연결 안내<ExternalLink size={16} /></a></aside></div>;
}
function Withdrawal({ onConfirm }: { onConfirm: (s: string) => void }) {
  const [reason, setReason] = useState(''), [agree, setAgree] = useState(false);
  return <><label>중단 사유<textarea value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="실명이나 구체적 의료정보는 입력하지 마세요." /></label><label className="check-line"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />이 참여자의 실험을 중단하는 것에 동의합니다.</label><Button secondary disabled={!reason.trim() || !agree} onClick={() => onConfirm(reason.trim())}>참여 중단 기록</Button></>;
}
