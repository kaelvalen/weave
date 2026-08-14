import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ArrowUp, X } from 'lucide-react';
import type { AgentQuestion } from '@/types/chat';
import { useChatStore } from '@/stores/useChatStore';

/* ─────────────────────────────────────────────────────────
 * QUESTIONS CARD (human-in-the-loop)
 * The agent asked structured clarifying questions before
 * acting — its turn is paused until this card is answered.
 * One question at a time; ring-dot pager shows progress;
 * ↑ submits on the last question. Radio auto-advances.
 * ───────────────────────────────────────────────────────── */

export function QuestionsCard({
  questionId,
  questions,
}: {
  questionId: string;
  questions: AgentQuestion[];
}) {
  const submitAnswers = useChatStore((s) => s.submitAnswers);
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [sent, setSent] = useState(false);

  if (questions.length === 0) return null;

  const question = questions[Math.min(qi, questions.length - 1)];
  const last = qi === questions.length - 1;
  const selected = answers[qi] ?? [];
  const hasAnswer = selected.length > 0 || Boolean(custom[qi]?.trim());

  const toggle = (index: number) => {
    setAnswers((current) => {
      const picked = current[qi] ?? [];
      const next =
        question.type === 'radio'
          ? [index]
          : picked.includes(index)
            ? picked.filter((item) => item !== index)
            : [...picked, index];
      return { ...current, [qi]: next };
    });
    if (question.type === 'radio') {
      setCustom((current) => ({ ...current, [qi]: '' }));
      // single-choice auto-advances, like the design
      window.setTimeout(() => {
        if (last) {
          void finish();
        } else {
          setQi((current) => Math.min(questions.length - 1, current + 1));
        }
      }, 480);
    }
  };

  const finish = async () => {
    if (sent) return;
    const full: string[] = questions.map((q, i) => {
      const picked = (answers[i] ?? []).map((idx) => q.options?.[idx] ?? String(idx)).join(', ');
      const typed = (custom[i] ?? '').trim();
      if (q.type === 'text') return typed;
      if (q.type === 'check') return picked;
      return picked || typed;
    });
    try {
      await submitAnswers(questionId, full);
      // brief "Answers sent" beat, then the store clears the card
      setSent(true);
      window.setTimeout(() => {
        useChatStore.getState().clearQuestions(questionId);
      }, 900);
    } catch {
      // the store toasted the failure; keep the card open for a retry
    }
  };

  const dismiss = () => {
    // No answers — the loop continues and the model decides how to proceed.
    void submitAnswers(questionId, []);
    useChatStore.getState().clearQuestions(questionId);
  };

  return (
    <div className="my-2 w-full max-w-80 self-start overflow-hidden rounded-[12px] bg-surface-2">
      {sent ? (
        <div className="flex h-[120px] flex-col items-center justify-center gap-2">
          <span
            className="flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white"
            style={{ animation: 'pop-in 300ms cubic-bezier(0.23,1,0.32,1) both' }}
          >
            <Check size={12} strokeWidth={3} />
          </span>
          <span
            className="text-[13px] font-medium text-foreground"
            style={{ animation: 'fade-up 350ms cubic-bezier(0.23,1,0.32,1) 100ms both' }}
          >
            Answers sent
          </span>
        </div>
      ) : (
        <div
          key={qi}
          className="p-3"
          style={{ animation: 'fade-up 350ms cubic-bezier(0.23,1,0.32,1) both' }}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="text-[13px] font-medium text-foreground">{question.question}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={dismiss}
              className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
            >
              <X size={14} strokeWidth={2.2} />
            </button>
          </div>
          <div className="mt-2 flex flex-col gap-0.5">
            {(question.options ?? []).map((option, i) => {
              const on = selected.includes(i);
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(i)}
                  className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-100 hover:bg-muted"
                >
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center transition-colors duration-200 ${
                      question.type === 'radio' ? 'rounded-full' : 'rounded-[5px]'
                    } ${
                      on
                        ? 'bg-foreground text-background'
                        : 'border-[1.5px] border-muted-foreground/60 text-transparent'
                    }`}
                  >
                    {question.type === 'radio' ? (
                      <span
                        className="size-1.5 rounded-full bg-background transition-transform duration-200"
                        style={{ transform: on ? 'scale(1)' : 'scale(0)' }}
                      />
                    ) : (
                      <Check size={12} strokeWidth={3} />
                    )}
                  </span>
                  <span
                    className={`text-[13px] transition-colors duration-200 ${
                      on ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {option}
                  </span>
                </button>
              );
            })}
            <label className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-100 focus-within:bg-muted hover:bg-muted">
              <span aria-hidden className="size-4 shrink-0" />
              <input
                value={custom[qi] ?? ''}
                onChange={(event) => {
                  setCustom((current) => ({ ...current, [qi]: event.target.value }));
                  if (question.type === 'radio') {
                    setAnswers((current) => ({ ...current, [qi]: [] }));
                  }
                }}
                placeholder="Type something…"
                aria-label="Custom answer"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
            </label>
          </div>
        </div>
      )}

      {/* footer — ring-dot pager + send arrow */}
      <div className="flex items-center justify-between border-t border-border/60 px-3 py-1.5">
        <span className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous"
            disabled={qi === 0 || sent}
            onClick={() => setQi((current) => Math.max(0, current - 1))}
            className="flex size-6 items-center justify-center rounded-[5px] text-muted-foreground transition-colors duration-100 enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-35"
          >
            <ChevronLeft size={14} strokeWidth={2.2} />
          </button>
          <span className="flex items-center gap-1">
            {questions.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to question ${i + 1}`}
                aria-current={i === qi && !sent ? 'step' : undefined}
                disabled={sent}
                onClick={() => setQi(i)}
                className="rounded-full transition-all duration-300 disabled:cursor-default"
                style={
                  i === qi && !sent
                    ? { width: 9, height: 9, border: '2.5px solid var(--foreground)' }
                    : sent || i < qi
                      ? { width: 7, height: 7, background: 'var(--muted-foreground)' }
                      : { width: 7, height: 7, border: '1.5px solid var(--muted-foreground)' }
                }
              />
            ))}
          </span>
          <button
            type="button"
            aria-label="Next"
            disabled={last || sent}
            onClick={() => setQi((current) => Math.min(questions.length - 1, current + 1))}
            className="flex size-6 items-center justify-center rounded-[5px] text-muted-foreground transition-colors duration-100 enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-35"
          >
            <ChevronRight size={14} strokeWidth={2.2} />
          </button>
        </span>
        {!sent && (
          <button
            type="button"
            aria-label={last ? 'Send answers' : 'Next question'}
            disabled={!hasAnswer}
            onClick={() => (last ? finish() : setQi((current) => current + 1))}
            className="-mr-0.5 flex size-7 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]"
            style={{
              background: hasAnswer ? 'hsl(var(--foreground))' : 'hsl(var(--surface-3))',
              color: hasAnswer ? 'hsl(var(--surface-1))' : 'hsl(var(--muted-foreground))',
            }}
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}
