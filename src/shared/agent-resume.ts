/** Only fixed commands with a validated session ID are ever typed into a restored tab. */
export interface AgentResume { agent: 'claude' | 'codex'; id: string }

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMMANDS: Record<AgentResume['agent'], (id: string) => string> = {
  claude: id => `claude --resume ${id}`,
  codex: id => `codex resume ${id}`,
};
export const AGENT_LABELS: Record<AgentResume['agent'], string> = { claude: 'Claude', codex: 'Codex' };

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

export function validateAgentResume(value: unknown): AgentResume {
  if (!value || typeof value !== 'object') throw new Error('Invalid agent session.');
  const { agent, id } = value as Record<string, unknown>;
  if ((agent !== 'claude' && agent !== 'codex') || !isSessionId(id)) throw new Error('Invalid agent session.');
  return { agent, id };
}

export function resumeCommand(resume: AgentResume): string {
  const valid = validateAgentResume(resume);
  return COMMANDS[valid.agent](valid.id);
}
