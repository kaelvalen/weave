import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionsCard } from './QuestionsCard';
import type { AgentQuestion } from '@/types/chat';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue('') }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/**
 * DOM-tier test for the `weave.ask_user` human-in-the-loop card. The backend
 * contract (QuestionsAsked event → store) is covered by useChatStore.test.ts;
 * this verifies the rendered card and that submitting an answer routes through
 * `chat_submit_answers`.
 */
describe('QuestionsCard (weave.ask_user human-in-the-loop)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    vi.useRealTimers();
  });
  afterEach(() => cleanup());

  const radio: AgentQuestion = {
    type: 'radio',
    question: 'Which plan?',
    options: ['a', 'b'],
  };
  const text: AgentQuestion = { type: 'text', question: 'Anything else?' };

  it('renders the current question and its options', () => {
    render(<QuestionsCard questionId="q1" questions={[radio]} />);
    expect(screen.getByText('Which plan?')).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });

  it('renders nothing for an empty question batch (defensive)', () => {
    render(<QuestionsCard questionId="q1" questions={[]} />);
    expect(screen.queryByText('Which plan?')).not.toBeInTheDocument();
  });

  it('submits the typed answer for a text question via chat_submit_answers', async () => {
    const user = userEvent.setup();
    render(<QuestionsCard questionId="q1" questions={[text]} />);

    await user.type(screen.getByLabelText('Custom answer'), 'postgres');
    const send = screen.getByLabelText('Send answers');
    expect(send).toBeEnabled();

    await user.click(send);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('chat_submit_answers', {
        questionId: 'q1',
        answers: ['postgres'],
      })
    );
  });

  it('marks a selected radio option as pressed', () => {
    render(<QuestionsCard questionId="q1" questions={[radio]} />);
    const option = screen.getByText('a').closest('button')!;
    fireEvent.click(option);
    expect(option).toHaveAttribute('aria-pressed', 'true');
  });
});
