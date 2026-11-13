import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  History,
  LoaderCircle,
  Plus,
  Send,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react';
import { gateway } from '../api/gateway';
import type {
  AssistantCapabilities,
  BookingProposal,
  ChatSession,
  Dialogue,
  GenerationRequest,
} from '../api/client';
import type { OfficeConfig } from '../model';
import { SERVER_SYNC_EVENT, type ServerSync } from '../api/ServerEvents';
import { assistantDisplayText, ProposalAutoOpenGuard } from './assistantPresentation';
import './assistant.css';

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Не удалось открыть помощника.';
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

export interface AssistantConversationState {
  hasConversation: boolean;
  hasDraft: boolean;
  processing: boolean;
}

export default function AssistantPanel({
  office,
  floorId,
  date,
  onClose,
  onBookingsChanged,
  onProposal,
  onConversationState,
}: {
  office: OfficeConfig;
  floorId: string;
  date: string;
  onClose: () => void;
  onBookingsChanged: () => Promise<void>;
  onProposal: (proposal: BookingProposal) => void;
  onConversationState?: (state: AssistantConversationState) => void;
}) {
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  const [capabilities, setCapabilities] = useState<AssistantCapabilities | null>(null);
  const [archives, setArchives] = useState<ChatSession[]>([]);
  const [history, setHistory] = useState(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [input, setInput] = useState('');
  const [request, setRequest] = useState<GenerationRequest | null>(null);
  const [processing, setProcessing] = useState<GenerationRequest | null>(null);
  const alive = useRef(false);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const requests = useRef(new Map<string, string>());
  const completed = useRef(new Set<string>());
  const autoOpen = useRef(new ProposalAutoOpenGuard());
  const proposalCallback = useRef(onProposal);
  proposalCallback.current = onProposal;
  const conversationCallback = useRef(onConversationState);
  conversationCallback.current = onConversationState;
  const sendAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (id: string | null = null) => {
      const version = ++generation.current;
      try {
        const [current, caps, old] = await Promise.all([
          id ? gateway.getChat(id) : gateway.getCurrentChat(),
          gateway.getAssistantCapabilities(),
          gateway.listArchivedChats(),
        ]);
        const requestId =
          current.session?.in_flight_request_id ||
          (current.session ? requests.current.get(current.session.id) : undefined);
        const result =
          !current.request && requestId ? await gateway.getGeneration(requestId) : null;
        if (!alive.current || version !== generation.current) return;
        // The selected dialogue is never replaced by a result from another, archived session.
        const selectedResult =
          result?.session && result.session.id === current.session?.id ? result : null;
        setDialogue(
          selectedResult
            ? { session: selectedResult.session, messages: selectedResult.messages }
            : current,
        );
        const selectedRequest = current.request || selectedResult?.request || null;
        autoOpen.current.pending(
          selectedRequest,
          (selectedResult?.session || current.session)?.id,
          id === null,
        );
        setRequest(selectedRequest);
        setProcessing(
          current.processing ??
            selectedResult?.processing ??
            (selectedRequest && ['pending', 'running'].includes(selectedRequest.status)
              ? selectedRequest
              : null),
        );
        setCapabilities(caps);
        setArchives(old);
        setAvailable(true);
        setError('');
        if (selectedRequest?.status === 'completed' && !completed.current.has(selectedRequest.id)) {
          completed.current.add(selectedRequest.id);
          void onBookingsChanged();
        }
      } catch (cause) {
        if (alive.current && version === generation.current) {
          setError(errorText(cause));
          setAvailable(false);
        }
      } finally {
        if (alive.current && version === generation.current) setLoading(false);
      }
    },
    [onBookingsChanged],
  );

  useEffect(() => {
    alive.current = true;
    void load(archiveId);
    const refresh = () => {
      if (document.visibilityState === 'visible' && !busyRef.current) void load(archiveId);
    };
    const sync = (event: Event) => {
      const data = (event as CustomEvent<ServerSync>).detail;
      if (data.type === 'ready' || data.type === 'resync' || data.type === 'chat.changed')
        refresh();
    };
    window.addEventListener(SERVER_SYNC_EVENT, sync);
    window.addEventListener('focus', refresh);
    return () => {
      alive.current = false;
      ++generation.current;
      window.removeEventListener(SERVER_SYNC_EVENT, sync);
      window.removeEventListener('focus', refresh);
    };
  }, [archiveId, load]);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight });
  }, [dialogue?.messages.length, request?.status]);
  useEffect(() => {
    const proposal = autoOpen.current.completed(request, dialogue?.session?.id, archiveId === null);
    if (proposal) proposalCallback.current(proposal);
  }, [request, dialogue?.session?.id, archiveId]);

  async function startNew() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError('');
    ++generation.current;
    let target = archiveId;
    try {
      const next = await gateway.newChat();
      if (!alive.current) return;
      setDialogue(next);
      setArchiveId(null);
      setHistory(false);
      setRequest(null);
      setError('');
      setLoading(false);
      if (next.processing !== undefined) setProcessing(next.processing);
      target = null;
    } catch (cause) {
      if (alive.current) setActionError(errorText(cause));
    } finally {
      busyRef.current = false;
      if (alive.current) {
        setBusy(false);
        void load(target);
      }
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (
      busyRef.current ||
      !input.trim() ||
      archiveId ||
      history ||
      !available ||
      !capabilities?.generationAvailable ||
      dialogue?.session?.in_flight_request_id ||
      (processing && ['pending', 'running'].includes(processing.status))
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setActionError('');
    ++generation.current;
    const message = input;
    const context = { officeId: office.id, floorId, date };
    try {
      let current = dialogue;
      if (!current?.session) {
        current = await gateway.newChat();
        if (!alive.current) return;
        setDialogue(current);
      }
      if (!current.session) throw new Error('Не удалось начать диалог.');
      const fingerprint = JSON.stringify({ sessionId: current.session.id, message, context });
      if (sendAttempt.current?.fingerprint !== fingerprint)
        sendAttempt.current = { fingerprint, key: crypto.randomUUID() };
      const result = await gateway.sendChatMessage(
        current.session.id,
        message,
        context,
        sendAttempt.current.key,
      );
      requests.current.set(result.request.session_id, result.request.id);
      sendAttempt.current = null;
      if (!alive.current) return;
      autoOpen.current.sent(result.request);
      setDialogue({ session: result.session, messages: result.messages });
      setRequest(result.request);
      setInput('');
      setProcessing(
        result.processing ??
          (['pending', 'running'].includes(result.request.status) ? result.request : null),
      );
    } catch (cause) {
      if (alive.current) setActionError(errorText(cause));
    } finally {
      busyRef.current = false;
      if (alive.current) {
        setBusy(false);
        void load();
      }
    }
  }

  const inFlight =
    !!dialogue?.session?.in_flight_request_id ||
    (!!processing && ['pending', 'running'].includes(processing.status));
  const hasConversation =
    archiveId === null && !!dialogue?.session && dialogue.session.archived_at === null;
  const hasDraft = !!input.trim();
  const conversationProcessing = busy || inFlight;
  useEffect(() => {
    conversationCallback.current?.({
      hasConversation,
      hasDraft,
      processing: conversationProcessing,
    });
  }, [hasConversation, hasDraft, conversationProcessing]);
  const disabled =
    busy ||
    loading ||
    !available ||
    !capabilities?.generationAvailable ||
    !!archiveId ||
    history ||
    inFlight;
  const savedProposals =
    dialogue?.messages.filter((item) => item.role === 'assistant' && item.proposal) || [];
  const latestProposal =
    request?.status === 'completed' && request.session_id === dialogue?.session?.id
      ? request.result?.proposal
      : null;
  const latestAnswer =
    latestProposal &&
    dialogue?.messages
      .slice()
      .reverse()
      .find(
        (item) =>
          item.role === 'assistant' &&
          item.content === request?.result?.message &&
          Date.parse(item.created_at) >= Date.parse(request.created_at),
      );
  const proposalAlreadyShown =
    latestProposal &&
    (latestAnswer ||
      savedProposals.some((item) =>
        ['officeId', 'floorId', 'resourceId', 'date', 'start', 'end', 'participants'].every(
          (key) =>
            (item.proposal?.[key as keyof BookingProposal] ?? null) ===
            (latestProposal[key as keyof BookingProposal] ?? null),
        ),
      ));
  const proposalButton = (proposal: BookingProposal) => (
    <button type="button" className="bk-chat-proposal" onClick={() => onProposal(proposal)}>
      Открыть форму бронирования
      <ArrowRight size={14} />
    </button>
  );

  return (
    <aside className="bk-chat" aria-label="Помощник бронирования">
      <div className="bk-chat-heading">
        <span>
          <Sparkles size={17} />
        </span>
        <div>
          <b>Ваш помощник</b>
          <small>{archiveId ? 'Архив диалога' : 'Подбор и бронирование'}</small>
        </div>
        <button
          type="button"
          aria-label="История диалогов"
          aria-pressed={history}
          disabled={busy}
          onClick={() => setHistory((value) => !value)}
        >
          <History size={16} />
        </button>
        <button
          type="button"
          aria-label="Новый диалог"
          disabled={busy || loading}
          onClick={() => void startNew()}
        >
          <Plus size={16} />
        </button>
        <button type="button" aria-label="Свернуть помощника" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <div className="bk-chat-content" ref={contentRef} aria-live="polite">
        {(error || actionError) && (
          <div className="bk-assistant-error" role="alert">
            {actionError || error}
            <button type="button" onClick={() => void load(archiveId)}>
              Обновить диалог
            </button>
          </div>
        )}
        {history ? (
          <div className="bk-chat-history">
            <b>Прошлые диалоги</b>
            {archives.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setArchiveId(item.id);
                  setHistory(false);
                  setLoading(true);
                }}
              >
                {dateLabel(item.created_at)}
              </button>
            ))}
            {!archives.length && !loading && <p>В архиве пока пусто</p>}
          </div>
        ) : (
          <>
            {archiveId && (
              <button
                type="button"
                className="bk-chat-back"
                onClick={() => {
                  setArchiveId(null);
                  setLoading(true);
                }}
              >
                <ArrowLeft size={13} />
                Текущий диалог
              </button>
            )}
            {loading && (
              <div className="bk-chat-loading">
                <LoaderCircle size={18} className="auth-spinner" />
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
                <LoaderCircle size={15} className="auth-spinner" />
                {processing && processing.session_id !== dialogue?.session?.id ? (
                  <>
                    Завершается предыдущий запрос
                    <button
                      type="button"
                      className="bk-chat-back"
                      onClick={() => {
                        setArchiveId(processing.session_id);
                        setLoading(true);
                      }}
                    >
                      Открыть диалог
                    </button>
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
        <input
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
        <button type="submit" disabled={disabled || !input.trim()} aria-label="Отправить сообщение">
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
}
