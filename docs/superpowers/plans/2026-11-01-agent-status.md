# Agent Status Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Show Working, Blocked, Done, and Idle for agents that explicitly report their status, with Done reserved for completions the user has not seen.

**Architecture:** Follow Herdr's separation of OSC 7501 reports from the user's attention state. Parse reports through the existing terminal OSC handler, reduce them into per-tab state, and render that state in the sidebar. Reuse the existing attention infrastructure for notifications without treating a generic bell as a lifecycle report.

**Tech Stack:** Existing TypeScript, xterm.js, Electron, node:test, and Playwright; no new dependencies.

**Spec:** The user's four definitions, reproduced below. This is a proposed plan for review; implementation is not authorized by this document alone.

**Research:** [Herdr implementation investigation](2026-11-01-herdr-status-investigation.md). The original custom OSC 777 proposal was replaced after inspecting Herdr and its companion core.

## Behaviour and scope

| Label | Meaning |
| --- | --- |
| Working | Still busy. |
| Blocked | Waiting for you. |
| Done | Finished while you were looking elsewhere. |
| Idle | Not working, or a finished agent you have looked at. |

Proposed decisions:

- A tab is being viewed when it is selected, its document is visible, its window has focus, and no modal dialog covers the terminal.
- A transition from Working or Blocked to reported Idle or Done is completion. Completion while being viewed goes directly to Idle; elsewhere it becomes Done until viewed or superseded by new work or a block. An initial Idle/Done report without a previous busy state shows Idle, matching Herdr's local attention rules.
- Selecting a Done tab, returning focus to its window, or closing an obscuring dialog acknowledges its completion once it is being viewed.
- Viewing or typing into a Blocked tab does not change its status. Only a new report changes it to Working or Idle; a completion report follows the Done rules.
- Idle/Done reports without an intervening busy state preserve existing acknowledgement. Repeated reports do not restore Done after acknowledgement.
- Reported Error displays as Blocked, matching Herdr. A root Clear report removes status; child records must not replace the root status.
- Only tabs that have reported status show these labels. Agent process detection alone cannot establish whether an agent is busy or waiting.
- Status is transient: a replacement agent, shell exit, closed tab, or app restart clears it. An agent ending a turn is distinct from its process exiting.

The initial scope assumes Y-Term handling and display. Native Claude Code/Codex hook configuration is a separate scope decision: the current code detects their processes and resume sessions, but contains no lifecycle reporting integration. Do not claim those agents report these states automatically.

## Approach

Use explicit terminal reports because they remain scoped to the PTY that produced them and fit the existing parser. Inferring activity from output volume, silence, process existence, or notification wording cannot reliably distinguish these four meanings. A local socket/hook server would also work but adds routing and lifecycle management that this first version does not need.

Use Herdr's OSC 7501 Program Status Protocol: colon-separated key/value fields such as `state=working:app=claude-code`, terminated by BEL or ST. States include `working`, `blocked`, `done`, `idle`, `error`, and `clear`. For example: `printf '\033]7501;state=working:app=codex\033\\'`. An absent or empty `id` identifies the root; a nonempty `id` identifies a child record. Accept metadata without mistaking it for state. The first version displays root status only, and must not advertise child-record UI support. Implement and test the protocol's capability query/reply before claiming compatibility: Herdr answers OSC `7501;?`, and some reporters may probe support first. Verify the exact response format against the protocol implementation before writing code. Agent hooks must be verified to write to the correct terminal before integrations are promised.

## Global constraints

- Keep the four labels and meanings exactly as specified above.
- Keep existing OSC 9, OSC 777 `notify`, bell handling, shell tabs, and update/resume behaviour.
- Do not infer status from terminal text, keyboard input, CPU usage, or timeouts.
- Status reports are untrusted presentation hints; never execute payloads or use them to authorize actions.
- Do not install or rewrite agent configuration as part of the initial scope.
- Before using any library-specific API during implementation, fetch current documentation with the required Context7 CLI workflow.

## Review focus

- A selected tab in an unfocused window must retain an unseen completion.
- Viewing a Blocked tab must not make it Idle or clear its status label.
- Duplicate reports and trailing Idle reports must not erase or recreate an acknowledged completion incorrectly.
- Reports fragmented across PTY writes must parse without swallowing ordinary notifications.
- A closed tab or replacement agent must not retain or receive another agent's status.

## File map

- Create `src/shared/agent-status.ts`: report parser, state types, and pure transition function.
- Create `tests/agent-status.test.ts`: parser and transition coverage.
- Modify `src/renderer/terminal-view.ts`: route status OSC payloads to a distinct callback; expose agent removal and shell exit to status cleanup.
- Modify `src/renderer/app.ts`: own tab state, observation tracking, sidebar rendering, and attention integration.
- Modify `src/renderer/styles.css`: readable state labels in both themes.
- Create `scripts/agent-status-smoke.ts` and call it from `scripts/smoke.ts`: exercise the real parser, sidebar, focus, and notifications.
- Modify `README.md`: meanings, reporting contract, and integration limits.

No new preload or main-process IPC is needed: status reports arrive through existing terminal output, and badge/notification requests already exist.

### Task 1: Define and test the status contract

**Interfaces** in `src/shared/agent-status.ts`:

- `AgentReport = { state: 'working' | 'blocked' | 'done' | 'idle' | 'error' | 'clear'; id: string; app?: string }`.
- `AgentStatusState = { reported?: AgentReport; unseenCompletion: boolean }`.
- `AgentStatusEvent = { type: 'report'; report: AgentReport; viewed: boolean } | { type: 'viewed' } | { type: 'reset' }`.
- `parseAgentStatus(data: string): AgentReport | undefined` consumes the OSC 7501 payload, excluding its introducer/terminator. Query/reply handling stays separate from report parsing.
- `reduceAgentStatus(state: AgentStatusState, event: AgentStatusEvent): AgentStatusState` returns the next state without side effects.
- `agentStatusLabel(state: AgentStatusState): 'Working' | 'Blocked' | 'Done' | 'Idle' | undefined` derives the visible label; undefined means no report received.

- [ ] Write table-driven tests in `tests/agent-status.test.ts` for all six states, invalid states, metadata, root versus child IDs, capability queries, and initially absent labels. Reject malformed reports and ignore unsupported metadata safely.
- [ ] Add transition assertions: working → Working; blocked/error + viewed → Blocked; working → done/idle while viewed → Idle; working/blocked → done/idle elsewhere → Done; initial idle/done → Idle; Done + viewed → Idle; Done + idle → Done; Done + working → Working; Done + blocked → Blocked; repeated idle/done after acknowledgement → Idle; child reports leave root unchanged; root clear/reset → no label.
- [ ] Run `node --experimental-strip-types --test tests/agent-status.test.ts` and confirm the tests fail before implementation.
- [ ] Implement the parser, reducer, and derived label. Reset both reported state and unseen completion on root clear/reset. Compare lifecycle state, rather than whole metadata objects, to detect completion and suppress duplicate transitions.
- [ ] Run the targeted tests and `npm run typecheck`; expect all to pass. Commit this task's files.

### Task 2: Wire reports, observation, and sidebar display

**Consumes:** Task 1's parser, reducer, state, and label function.

**Produces:** `TerminalView` accepts an additional callback `agentStatus: (report: AgentReport) => void` and a distinct lifecycle callback `ended: () => void`. Each tab owns an `AgentStatusState` and a visible `.tab-agent-status` element.

- [ ] Add a real-xterm smoke helper in `scripts/agent-status-smoke.ts`, exported as `verifyAgentStatus(application: ElectronApplication, page: Page): Promise<void>`, and invoke it from `scripts/smoke.ts`. First assert Working after a report and Done → Idle after background completion and selection; run `npm run test:e2e` to observe failure before wiring.
- [ ] Register an OSC 7501 handler alongside the existing OSC 777 notification handler. Route root reports to the status callback; consume child reports without changing the root label. Handle capability queries using a reply advertising only the implemented protocol subset. Keep xterm responsible for framing across writes; do not parse raw PTY chunks independently.
- [ ] In `app.ts`, add one observation predicate with the conditions above and one state/render path for reports, viewing, and reset. Recheck observation on selection, window focus, document visibility changes, and settings-dialog close.
- [ ] Render the label beside the existing tab text, independently of terminal titles and agent identity icons. Add a stable `data-agent-status` attribute, descriptive accessible text, and light/dark theme colours; colour must supplement the visible words.
- [ ] Reset status immediately on root clear or shell exit. For known agent processes, reset when the previously known agent disappears or changes. Initial process detection must not erase earlier reports, and lack of a recognized agent brand must not suppress valid reports from other programs. Ignore callbacks after tab disposal.
- [ ] Extend smoke assertions to cover selected-but-unfocused completion, completion under an open settings dialog, Blocked remaining after selection/input, fragmented OSC writes, duplicate done, trailing idle, and independent tabs. Preserve a regression for generic OSC 777 notifications. Assert removed-agent and exited-shell cleanup using the existing event test harness or real PTY as appropriate.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`; expect all to pass. Commit the UI and smoke changes.

### Task 3: Integrate attention behaviour and document reporting

**Consumes:** Task 2's tab state and observation predicate; existing `setAttentionCount` and `notifyAttention` APIs.

**Produces:** One consistent per-tab attention calculation without changing the existing main-process APIs.

- [ ] Add smoke assertions before implementation: an unseen completion raises attention once; viewing it clears its contribution; a Blocked report keeps its label after viewing; a fresh Working/Idle report resolves its blocked contribution; closing the tab removes its badge contribution.
- [ ] Keep the existing generic-notification attention flag separate from status state. For reporting tabs, badge membership is `genericAttention || statusLabel === 'Blocked' || statusLabel === 'Done'`; count each tab once. Viewing clears generic attention and acknowledges Done, while Blocked remains counted until resolved. This badge policy is a proposal for review, beyond the four label definitions.
- [ ] Notify once on entry into an unseen Blocked or Done state, suppressing desktop notifications while viewed. Repeated identical reports must not repeat notifications. A later work cycle can notify again. Reuse notification activation to select the correct tab.
- [ ] Extend `scripts/agent-status-smoke.ts` with multi-tab badge deduplication and blocked→working, repeated reports, notification activation, and tab-close cases. Rerun the existing attention smoke coverage to ensure ordinary terminals retain their behaviour.
- [ ] Document the four meanings and reporting example in `README.md`. State that unconfigured agents retain existing detection/attention behaviour and require a compatible reporter to display lifecycle status. Record whether native agent integrations were included by subsequent user direction.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, and `git diff --check`; expect all to pass. Review the final diff and record actual results before claiming completion. Commit the final task.

## Acceptance walkthrough

Start work in tab A: Working. Switch to tab B; A finishes: Done. Select A: Idle. A asks for approval: Blocked, including while selected. Approve the request; its next working report changes it to Working. It finishes while A is visible and focused: Idle immediately. Repeat with the window unfocused: Done until focus returns. A plain shell without reports continues to behave as it does today.
