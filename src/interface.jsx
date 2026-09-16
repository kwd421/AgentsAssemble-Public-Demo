import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, AtSign, BookOpen, ChevronRight, Hash, MessageSquare, Pencil, Save, X } from 'lucide-react';

const INSTRUCTION_HINTS = {
  strategist: '예: 목표를 먼저 정리하고, 중요한 선택지 두 가지를 비교하세요.',
  engineer: '예: 구현 가능성을 우선 검토하고, 결론·이유·리스크 순으로 답하세요.',
  critic: '예: 앞선 답변의 근거를 점검하고, 놓친 조건이 있을 때만 반론을 제시하세요.',
};

export function AgentAvatar({ agent, large = false, human = false }) {
  return <span className={`aa-avatar${large ? ' aa-avatar-large' : ''}${human ? ' aa-avatar-human' : ''}`} data-agent={agent?.id} aria-hidden="true">{human ? '나' : agent?.initial || 'A'}</span>;
}

function AgentBanner({ agent, name, index, compact = false }) {
  return <div className={`aa-profile-identity${compact ? ' compact' : ''}`}>
    <div className="aa-profile-banner" aria-hidden="true"><span className="aa-banner-mark" /><span className="aa-banner-index">{index == null ? 'AI' : `0${index + 1}`}</span></div>
    <div className="aa-profile-title"><AgentAvatar agent={agent} large /><h3>{name || agent.name}</h3><span className="aa-profile-handle">@{agent.mention || `ai${(index ?? 0) + 1}`}</span></div>
  </div>;
}

function ProfileFields({ agent, name, instruction, onName, onInstruction, disabled, setup = false }) {
  const id = useId();
  return <div className="aa-profile-fields">
    <div className="aa-field"><div className="aa-field-label"><label htmlFor={`${id}-name`}>프로필 이름</label><span aria-hidden="true">{name.length} / 40</span></div><input id={`${id}-name`} autoComplete="off" value={name} onChange={e => onName(e.target.value)} maxLength={40} disabled={disabled} placeholder={setup ? agent.name : '예: 제품 기획자'} /></div>
    <div className="aa-field"><div className="aa-field-label"><label htmlFor={`${id}-instruction`}>지시문</label><span aria-hidden="true">{instruction.length} / 1200</span></div><textarea id={`${id}-instruction`} value={instruction} onChange={e => onInstruction(e.target.value)} maxLength={1200} rows={7} disabled={disabled} aria-describedby={`${id}-hint`} placeholder={setup ? agent.instruction : INSTRUCTION_HINTS[agent.id] || '역할, 판단 기준, 답변 형식을 입력합니다.'} /><p id={`${id}-hint`} className="aa-field-hint">{setup ? '비워두면 현재 지시문을 사용합니다.' : '역할과 답변 형식, 우선할 기준을 적습니다.'}</p></div>
  </div>;
}

export function AgentProfileEditor({ agent, disabled, pending, onBack, onMention, onSave }) {
  const [name, setName] = useState(agent.name);
  const [instruction, setInstruction] = useState(agent.instruction || '');
  useEffect(() => { setName(agent.name); setInstruction(agent.instruction || ''); }, [agent.id, agent.name, agent.instruction]);
  const cleanName = name.trim(), cleanInstruction = instruction.trim();
  const invalid = !cleanName || cleanName.length > 40 || !cleanInstruction || cleanInstruction.length > 1200;
  const dirty = cleanName !== agent.name || cleanInstruction !== (agent.instruction || '');
  return <section className="aa-profile-editor" data-agent={agent.id} aria-label="에이전트 프로필 편집">
    <button type="button" className="aa-back-button" onClick={onBack}><ArrowLeft size={16} />멤버 목록</button>
    <AgentBanner agent={agent} name={cleanName} compact />
    <div className="aa-model-line"><span>모델</span><span title={agent.model}>{agent.model || '미설정'}</span></div>
    <ProfileFields agent={agent} name={name} instruction={instruction} onName={setName} onInstruction={setInstruction} disabled={disabled} />
    <p className="aa-profile-scope">저장한 설정은 이 방의 다음 응답부터 적용됩니다. 방이 만료되면 함께 삭제됩니다.</p>
    <div className="aa-profile-actions"><button type="button" className="aa-button secondary" onClick={onMention} disabled={disabled} title={`@${agent.mention || 'ai'} 입력`}><AtSign size={16} />@{agent.mention || 'ai'}</button><button type="button" className="aa-button primary" disabled={disabled || invalid || !dirty} onClick={() => onSave(agent.id, cleanName, cleanInstruction)}><Save size={15} />{pending ? '저장 중…' : '변경 저장'}</button></div>
  </section>;
}

export function RoomGuide({ onOpen }) {
  return <section className="aa-room-guide" aria-label="데모 사용 안내">
    <h3>이 방의 사용법</h3>
    <div className="aa-guide-item"><MessageSquare size={17} /><p>질문을 보내면 세 에이전트가 차례로 답합니다.</p></div>
    <div className="aa-guide-item"><AtSign size={17} /><p><code>@ai2</code>처럼 입력하면 해당 에이전트만 답합니다.</p></div>
    <div className="aa-guide-item"><Pencil size={17} /><p>오른쪽 멤버를 누르면 이름과 지시문을 수정할 수 있습니다.</p></div>
    <button type="button" className="aa-guide-open" onClick={onOpen}><BookOpen size={16} />사용 안내 및 설정<ArrowRight size={15} /></button>
  </section>;
}

export function IntroModal({ agents, connected, pending, onApply, onClose }) {
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialog = useRef(null), title = useRef(null), scrollArea = useRef(null);
  const alive = useRef(true), applying = useRef(false);
  const locked = pending || saving;
  const ready = connected && agents.length === 3;
  useEffect(() => {
    alive.current = true;
    const node = dialog.current;
    if (!node.open) node.showModal();
    title.current?.focus({ preventScroll: true });
    return () => { alive.current = false; if (node.open) node.close(); };
  }, []);
  useEffect(() => { title.current?.focus({ preventScroll: true }); if (scrollArea.current) scrollArea.current.scrollTop = 0; }, [page]);
  function close() { if (!locked && !applying.current) onClose(); }
  function setField(id, field, value) { setSaveError(''); setDrafts(d => ({ ...d, [id]: { ...(d[id] || {}), [field]: value } })); }
  function applyProfiles(e) {
    e.preventDefault();
    if (locked || applying.current || !ready) return;
    const updates = agents.map(agent => {
      const draft = drafts[agent.id] || {};
      const name = (draft.name || '').trim(), instruction = (draft.instruction || '').trim();
      if (!name && !instruction) return null;
      return { agentId: agent.id, name: name || agent.name, instruction: instruction || agent.instruction };
    }).filter(Boolean);
    if (!updates.length) { onClose(); return; }
    if (updates.some(a => a.name.length > 40 || a.instruction.length > 1200)) { setSaveError('이름은 40자, 지시문은 1,200자까지 입력할 수 있습니다.'); return; }
    setSaveError(''); applying.current = true; setSaving(true);
    const started = onApply(updates, ok => {
      applying.current = false;
      if (!alive.current) return;
      setSaving(false);
      if (ok) onClose();
      else setSaveError('저장을 완료하지 못했습니다. 일부 항목은 적용되었을 수 있습니다. 입력 내용은 유지됩니다.');
    });
    if (!started) { applying.current = false; setSaving(false); setSaveError('연결 상태를 확인한 뒤 다시 저장해 주세요.'); }
  }
  return <dialog ref={dialog} className={`aa-dialog${page === 1 ? ' aa-dialog-setup' : ''}`} aria-labelledby="aa-dialog-title" aria-describedby="aa-dialog-description" onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="aa-dialog-inner">
      <header className="aa-dialog-bar"><span className="aa-room-address"><Hash size={17} />AgentsAssemble<span>/</span>general</span><div className="aa-dialog-stepper" aria-label={`설정 ${page + 1} / 2 단계`}><span data-current={page === 0}>01 안내</span><span className="aa-step-rule" /><span data-current={page === 1}>02 프로필</span></div><button type="button" className="aa-close-button" onClick={close} disabled={locked} aria-label="안내 닫기"><X size={20} /></button></header>
      {page === 0 ? <>
        <div className="aa-dialog-scroll aa-welcome" ref={scrollArea}>
          <div className="aa-welcome-copy"><span className="aa-small-label">처음 오셨나요?</span><h2 id="aa-dialog-title" ref={title} tabIndex={-1}>대화 시작</h2><p id="aa-dialog-description" className="aa-dialog-description">한 방에서 세 에이전트의<br className="aa-desktop-break" /> 의견을 함께 확인합니다.</p><div className="aa-welcome-instructions"><p>질문을 보내면 세 에이전트가 순서대로 답합니다. 별도의 명령어는 필요하지 않습니다.</p><p>한 명만 부를 때는 <code>@ai1</code>, <code>@ai2</code>, <code>@ai3</code> 중 하나를 사용합니다. 이름과 지시문은 다음 화면이나 오른쪽 멤버 패널에서 수정할 수 있습니다.</p></div></div>
          <div className="aa-welcome-roster"><div className="aa-roster-heading">대화에 참여하는 에이전트<span>3</span></div>{['strategist', 'engineer', 'critic'].map((id, index) => { const agent = agents.find(a => a.id === id) || { id, mention: `ai${index + 1}`, name: '연결 중…', initial: id[0].toUpperCase() }; return <div className="aa-welcome-member" data-agent={id} key={id}><AgentAvatar agent={agent} /><div><strong>{agent.name}</strong><p>@{agent.mention || `ai${index + 1}`}</p></div><span className="aa-member-order">0{index + 1}</span></div>; })}<p className="aa-roster-note">각 에이전트는 앞선 답변을 읽고<br />자신의 지시문에 따라 이어서 답합니다.</p></div>
          <details className="aa-technical-note"><summary>동작 방식<ChevronRight size={15} /></summary><p>서버가 대화 기록과 에이전트별 지시문을 AI 모델에 전달합니다. WebSocket 연결로 응답과 상태를 화면에 실시간 반영합니다. 이 공개 데모에는 웹 검색과 로컬 파일 접근 기능이 없습니다.</p></details>
        </div>
        <footer className="aa-dialog-footer"><p>설정은 나중에 바꿀 수 있습니다.</p><div><button type="button" className="aa-button quiet" onClick={close} disabled={locked}>바로 입장</button><button type="button" className="aa-button primary" onClick={() => setPage(1)} disabled={locked}>다음<ArrowRight size={17} /></button></div></footer>
      </> : <form className="aa-setup-form" onSubmit={applyProfiles}>
        <div className="aa-dialog-scroll" ref={scrollArea}>
          <div className="aa-setup-heading"><div><button type="button" className="aa-back-button" onClick={() => setPage(0)} disabled={locked}><ArrowLeft size={16} />이전</button><h2 id="aa-dialog-title" ref={title} tabIndex={-1}>에이전트 설정</h2><p id="aa-dialog-description" className="aa-dialog-description">이름과 지시문을 수정할 수 있습니다. 비워둔 항목은 현재 설정을 유지합니다.</p></div><span className="aa-optional-label">선택 사항</span></div>
          {agents.length === 3 ? <div className="aa-setup-grid">{agents.map((agent, index) => { const draft = drafts[agent.id] || {}; return <article className="aa-setup-card" data-agent={agent.id} key={agent.id} aria-label={`${agent.name} 설정`}>
            <AgentBanner agent={agent} name={(draft.name || '').trim()} index={index} />
            <ProfileFields agent={agent} name={draft.name || ''} instruction={draft.instruction || ''} onName={value => setField(agent.id, 'name', value)} onInstruction={value => setField(agent.id, 'instruction', value)} disabled={locked || !connected} setup />
          </article>; })}</div> : <p className="aa-loading" role="status">에이전트 설정을 불러오는 중입니다.</p>}
          <div className="aa-setup-notes"><p><Pencil size={16} />역할, 판단 기준, 답변 형식을 구체적으로 적으면 지시가 더 명확해집니다.</p></div>
          {saveError && <p className="aa-setup-error" role="alert">{saveError}</p>}
          {!connected && <p className="aa-connection-note" role="status">서버 연결을 기다리고 있습니다. 입력 내용은 유지됩니다.</p>}
        </div>
        <footer className="aa-dialog-footer"><p>이 방에만 적용됩니다.</p><div><button type="button" className="aa-button quiet" onClick={close} disabled={locked}>변경 없이 입장</button><button type="submit" className="aa-button primary" disabled={locked || !ready}>{locked ? '저장 중…' : '저장 후 입장'}<ArrowRight size={17} /></button></div></footer>
      </form>}
    </div>
  </dialog>;
}
