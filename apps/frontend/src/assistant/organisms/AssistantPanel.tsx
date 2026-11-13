import { ArrowLeft, History, Plus, Send, Sparkles, WifiOff, X } from 'lucide-react';
import { Button, IconButton, Input, Styles, Spinner } from '../../shared/atoms';
import type { BookingProposal } from '../../shared/api';
import type { AssistantPanelProps } from '../types';
import { useAssistant } from '../hooks/useAssistant';
import { assistantDisplayText } from '../lib/assistantPresentation';
import { ProposalAction } from '../molecules/ProposalAction';
export type { AssistantConversationState } from '../types';
const dateLabel = (value: string): string =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
export default function AssistantPanel(props: AssistantPanelProps) {
  const { onClose, onProposal } = props;
  const {
    dialogue,
    capabilities,
    archives,
    history,
    setHistory,
    archiveId,
    setArchiveId,
    loading,
    setLoading,
    busy,
    error,
    actionError,
    setActionError,
    input,
    setInput,
    request,
    processing,
    contentRef,
    load,
    startNew,
    send,
    inFlight,
    disabled,
    latestProposal,
    latestAnswer,
    proposalAlreadyShown,
  } = useAssistant(props);
  const proposalButton = (proposal: BookingProposal) => (
    <ProposalAction proposal={proposal} onProposal={onProposal} />
  );
  return (
    <>
      <Styles id="assistant-panel">{styles}</Styles>
      <aside className="bk-chat" aria-label="Помощник бронирования">
        <div className="bk-chat-heading">
          <span>
            <Sparkles size={17} />
          </span>
          <div>
            <b>Ваш помощник</b>
            <small>{archiveId ? 'Архив диалога' : 'Подбор и бронирование'}</small>
          </div>
          <IconButton
            variant="ghost"
            size="sm"
            type="button"
            aria-label="История диалогов"
            aria-pressed={history}
            disabled={busy}
            onClick={() => setHistory((value) => !value)}
          >
            <History size={16} />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            type="button"
            aria-label="Новый диалог"
            disabled={busy || loading}
            onClick={() => void startNew()}
          >
            <Plus size={16} />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            type="button"
            aria-label="Свернуть помощника"
            onClick={onClose}
          >
            <X size={17} />
          </IconButton>
        </div>
        <div className="bk-chat-content" ref={contentRef} aria-live="polite">
          {(error || actionError) && (
            <div className="bk-assistant-error" role="alert">
              {actionError || error}
              <Button type="button" onClick={() => void load(archiveId)}>
                Обновить диалог
              </Button>
            </div>
          )}
          {history ? (
            <div className="bk-chat-history">
              <b>Прошлые диалоги</b>
              {archives.map((item) => (
                <Button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    setArchiveId(item.id);
                    setHistory(false);
                    setLoading(true);
                  }}
                >
                  {dateLabel(item.created_at)}
                </Button>
              ))}
              {!archives.length && !loading && <p>В архиве пока пусто</p>}
            </div>
          ) : (
            <>
              {archiveId && (
                <Button
                  type="button"
                  className="bk-chat-back"
                  onClick={() => {
                    setArchiveId(null);
                    setLoading(true);
                  }}
                >
                  <ArrowLeft size={13} />
                  Текущий диалог
                </Button>
              )}
              {loading && (
                <div className="bk-chat-loading">
                  <Spinner size={18} />
                  Загружаем диалог
                </div>
              )}
              {dialogue?.messages
                .filter((item) => item.role === 'user' || item.role === 'assistant')
                .map((item) => {
                  const proposal =
                    item.role === 'assistant'
                      ? item.proposal ||
                        (latestAnswer && item.id === latestAnswer.id ? latestProposal : null)
                      : null;
                  return (
                    <div
                      className={
                        'bk-chat-message ' + (item.role === 'user' ? 'is-user' : 'is-assistant')
                      }
                      key={item.id}
                    >
                      {assistantDisplayText(item.content, {
                        role: item.role,
                        proposal,
                        origin: window.location.origin,
                      })}
                      {proposal && proposalButton(proposal)}
                    </div>
                  );
                })}
              {latestProposal && !proposalAlreadyShown && proposalButton(latestProposal)}
              {request?.status === 'failed' && (
                <div className="bk-assistant-error" role="alert">
                  Помощник не смог ответить. Попробуйте отправить новое сообщение.
                </div>
              )}
              {!loading && !archiveId && capabilities?.generationAvailable === false && (
                <div className="bk-chat-unavailable">
                  <WifiOff size={17} />
                  <div>
                    <b>Ответы помощника пока недоступны</b>
                    <p>История сохраняется на сервере. Место можно выбрать на плане.</p>
                  </div>
                </div>
              )}
              {!loading &&
                !dialogue?.messages.length &&
                !error &&
                (archiveId ? (
                  <p>В этом диалоге нет сообщений</p>
                ) : (
                  capabilities?.generationAvailable && (
                    <p className="bk-chat-empty">Опишите место, время и нужное оснащение.</p>
                  )
                ))}
              {inFlight && (
                <div className="bk-chat-loading">
                  <Spinner size={15} />
                  {processing && processing.session_id !== dialogue?.session?.id ? (
                    <>
                      Завершается предыдущий запрос
                      <Button
                        type="button"
                        className="bk-chat-back"
                        onClick={() => {
                          setArchiveId(processing.session_id);
                          setLoading(true);
                        }}
                      >
                        Открыть диалог
                      </Button>
                    </>
                  ) : (
                    'Помощник отвечает…'
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <form className="bk-chat-input" onSubmit={send}>
          <Input
            placeholder="Какое место вам нужно?"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setActionError('');
            }}
            maxLength={8000}
            disabled={disabled}
            aria-label="Сообщение помощнику"
          />
          <IconButton
            variant="ghost"
            size="sm"
            type="submit"
            disabled={disabled || !input.trim()}
            aria-label="Отправить сообщение"
          >
            <Send size={16} />
          </IconButton>
        </form>
      </aside>
    </>
  );
}

const styles = String.raw`
.bk-chat {
  position: absolute;
  right: 20px;
  bottom: 15px;
  z-index: 12;
  width: 326px;
  max-height: calc(100% - 30px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #e2e7f1;
  background: #fff;
  border-radius: 13px;
  box-shadow: 0 15px 45px #40577f20;
}
.bk-chat .bk-chat-heading {
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid #edf0f6;
  flex-shrink: 0;
}
.bk-chat .bk-chat-heading > span {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: #8d99dc;
  background: #f0f2fd;
  border-radius: 8px;
}
.bk-chat .bk-chat-heading b {
  display: block;
  font-size: 11px;
  font-weight: 650;
  color: #7b8bad;
}
.bk-chat .bk-chat-heading small {
  display: block;
  color: #b1b9c9;
  font-size: 8px;
  margin-top: 4px;
}
.bk-chat .bk-chat-heading button {
  margin-left: auto;
  color: #9eabc0;
  background: none;
  padding: 4px;
}
.bk-chat .bk-chat-content {
  overflow: auto;
  padding: 17px;
}
.bk-chat .bk-chat-welcome {
  text-align: center;
  padding: 6px 8px 13px;
  color: #9aa7d6;
}
.bk-chat .bk-chat-welcome > svg {
  margin: auto;
}
.bk-chat .bk-chat-welcome h3 {
  font-size: 13px;
  line-height: 1.5;
  color: #8090ae;
  margin: 11px 0 7px;
}
.bk-chat .bk-chat-welcome p {
  font-size: 10px;
  line-height: 1.7;
  color: #a7b1c3;
  margin: 0;
}
.bk-chat .bk-chat-unavailable {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  border: 1px solid #ece8dc;
  background: #fffdf7;
  border-radius: 8px;
  color: #b9ac8a;
}
.bk-chat .bk-chat-unavailable > svg {
  flex-shrink: 0;
}
.bk-chat .bk-chat-unavailable b {
  font-size: 10px;
  font-weight: 650;
  color: #a69b84;
}
.bk-chat .bk-chat-unavailable p {
  font-size: 9px;
  line-height: 1.7;
  color: #b9b1a1;
  margin: 5px 0 0;
}
.bk-chat .bk-chat-manual {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  background: none;
  color: #92a0c5;
  font-size: 10px;
  padding: 14px 0 0;
}
.bk-chat .bk-chat-input {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 12px;
  border-top: 1px solid #edf0f6;
  flex-shrink: 0;
}
.bk-chat .bk-chat-input input {
  width: 100%;
  background: #fafbfe;
  border: 1px solid #edf0f7;
  border-radius: 7px;
  padding: 9px;
  color: #c3cad7;
  font-size: 10px;
}
.bk-chat .bk-chat-input button {
  display: grid;
  place-items: center;
  height: 30px;
  width: 30px;
  flex-shrink: 0;
  border-radius: 6px;
  background: #edf0fc;
  color: #aeb9df;
}
@media (max-width: 720px) {
  .bk-chat {
    right: 10px;
    left: 10px;
    width: auto;
    max-width: 335px;
    bottom: 11px;
    max-height: calc(100% - 22px);
  }
  .bk-chat .bk-chat-welcome {
    display: none;
  }
  .bk-chat .bk-chat-heading {
    padding: 11px;
  }
  .bk-chat .bk-chat-content {
    padding: 12px;
  }
}
.bk-chat {
  display: flex;
  flex-direction: column;
}
.bk-chat .bk-chat-heading {
  flex-shrink: 0;
  gap: 8px;
}
.bk-chat .bk-chat-heading > div {
  min-width: 0;
  flex: 1;
}
.bk-chat .bk-chat-heading > button {
  flex: 0 0 25px;
  width: 25px;
  margin-left: 0;
}
.bk-chat .bk-chat-content {
  min-height: 120px;
  max-height: 330px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bk-chat .bk-chat-message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-width: 95%;
  font-size: 12px;
  line-height: 1.65;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f0f3f9;
  color: #455572;
}
.bk-chat .bk-chat-message.is-user {
  align-self: flex-end;
  background: #edf0ff;
  color: #5366a2;
}
.bk-chat .bk-chat-message.is-assistant {
  align-self: flex-start;
}
.bk-chat .bk-chat-loading {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  color: #7789a4;
}
.bk-chat .bk-assistant-error {
  font-size: 11px;
  color: #a64f57;
  padding: 10px;
  background: #fff1f1;
  border-radius: 8px;
  line-height: 1.6;
}
.bk-chat .bk-assistant-error button,
.bk-chat .bk-chat-back {
  background: transparent;
  border: 0;
  color: #677cbb;
  font-size: 11px;
  padding: 5px 0;
  display: flex;
  gap: 6px;
  align-items: center;
}
.bk-chat .bk-chat-history {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 11px;
}
.bk-chat .bk-chat-history > b {
  color: #657795;
  margin-bottom: 4px;
}
.bk-chat .bk-chat-history > button {
  padding: 10px;
  text-align: left;
  border: 1px solid #e8edf5;
  border-radius: 8px;
  background: white;
  color: #627697;
}
.bk-chat .bk-chat-history > p {
  color: #8b9ab0;
}
.bk-chat .bk-chat-input {
  flex-shrink: 0;
}
.bk-chat .bk-save-error {
  max-width: calc(100% - 100px);
  z-index: 10;
}
.bk-chat .bk-save-error button {
  margin-left: 10px;
  background: transparent;
  border: 0;
  text-decoration: underline;
  color: inherit;
}
.bk-chat .bk-chat-proposal {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #dbe3f6;
  border-radius: 8px;
  padding: 10px 12px;
  background: #f2f5ff;
  font:
    600 11px/1.5 Manrope,
    system-ui,
    sans-serif;
  color: #667fbb;
  max-width: 100%;
  text-align: left;
}
.bk-chat .bk-chat-message > .bk-chat-proposal {
  margin-top: 10px;
}
.bk-chat .bk-chat-empty {
  font-size: 12px;
  line-height: 1.7;
  color: #8999b2;
}
.bk-chat .bk-chat-heading > .ui-icon-button {
  border: 0;
  background: transparent;
  flex-shrink: 0;
}
.bk-chat .bk-chat-input > .ui-input {
  border: 0;
  box-shadow: none;
  background: transparent;
  padding: 0;
  font-size: 11px;
}
.bk-chat .bk-chat-input > .ui-icon-button {
  background: #7d89dc;
  color: #fff;
  border: 0;
}
`;
