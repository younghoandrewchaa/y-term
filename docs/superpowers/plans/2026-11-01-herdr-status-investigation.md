# Herdr agent status investigation

Inspected source, not a running installation. App commit: `1581a587919dddd6f1efd5f78eb542c4b2b02cb5`; core commit: `7a54c2975225a859b7e7d67302df5efc249fb9d0`.

## Report transport

Herdr receives status from the program through OSC 7501, named the Program Status Protocol. Its companion herdr-core owns terminal parsing and stores reports. The desktop subscribes to core events/snapshots. Neither component infers status from screen text or agent brand. Core's contribution policy explicitly excludes per-agent integrations/hooks.

- [Core status policy](https://github.com/herdrdev/herdr-core/blob/7a54c2975225a859b7e7d67302df5efc249fb9d0/CONTRIBUTING.md)
- [Core report storage and transitions](https://github.com/herdrdev/herdr-core/blob/7a54c2975225a859b7e7d67302df5efc249fb9d0/crates/herdr-core/src/status.rs)
- [Core parsing tests](https://github.com/herdrdev/herdr-core/blob/7a54c2975225a859b7e7d67302df5efc249fb9d0/crates/ghostty-vt/src/tests.rs#L156-L173)

Observed wire examples:

```text
ESC ] 7501 ; state=working:app=claude-code:progress=40 ESC \
ESC ] 7501 ; state=blocked:kind=permission:id=a/b:msg=QXBwbHk/ BEL
ESC ] 7501 ; state=clear ESC \
```

States: idle, working, done, blocked, error, clear. Fields include id, app, kind, progress, title, and msg; text fields title/msg use base64 in core's encoder. No id means the root record; named IDs are independent child records. An explicitly empty id is invalid. Clear removes the specified record and its descendants; root clear removes everything. Tests also demonstrate a capability query (`OSC 7501;?`) and a response.

Implementation follow-up: traced the [pinned Ghostty parser](https://github.com/ghostty-org/ghostty/blob/1e5cdb865807abc990181efb8ebfa9122955cce2/src/terminal/osc/parsers/program_status.zig) and [protocol specification](https://www.superlogical.com/rex/docs/build/program-status). The query reply payload is `?:states=idle,working,done,blocked,error:kinds=permission,question,auth`. The public xterm callback supplies only the payload, so Y-Term replies using canonical ST termination. It implements root-label presentation; child records are consumed without replacing root status.

## Display and attention

The desktop's [Agent model and transitions](https://github.com/herdrdev/herdr-app/blob/1581a587919dddd6f1efd5f78eb542c4b2b02cb5/src/model.rs#L437-L513) store the raw word separately from seen state:

| Report | Display |
| --- | --- |
| working | Working |
| blocked or error | Blocked, regardless of seen state |
| idle or done | Done if unseen; otherwise Idle |
| no report | No agent status |

With local seen rules, transitioning from working/blocked to a nonbusy state marks completion unseen unless the person is looking. An initial idle/done does not itself create an unseen completion. Duplicate state words do not change acknowledgement. Viewing marks the result seen; typing is not the status source.

The app also supports shared acknowledgement across clients: core increments `turn` whenever the root leaves working, including working→blocked, clear, and exit. The optional `herdr.seen` label records the viewed turn. For finished states, `turn > seen_turn` means Done. This shared rule takes precedence over the local seen flag. See [shared-label semantics](https://github.com/herdrdev/herdr-app/blob/1581a587919dddd6f1efd5f78eb542c4b2b02cb5/docs/labels.md).

[Window integration](https://github.com/herdrdev/herdr-app/blob/1581a587919dddd6f1efd5f78eb542c4b2b02cb5/src/window.rs#L1931-L2013) considers a terminal viewed when it is drawn in the active window. Covered terminals do not count. New blocked/error states alert; finishing alerts only when unseen. The first listing suppresses historic alerts, and child agents do not directly notify the person.

The [agents sidebar](https://github.com/herdrdev/herdr-app/blob/1581a587919dddd6f1efd5f78eb542c4b2b02cb5/defaults/mods/agents/main.js#L124-L135) ranks Blocked > Done > Working > Idle. After a selected Done agent becomes Idle, it keeps its Done group position until the user leaves, preventing the row from jumping during interaction. This is sorting stability, not a different lifecycle state.

## Implications for Y-Term

1. Replace the proposed custom OSC 777 status format with OSC 7501; retain existing notification protocols independently.
2. Keep raw reported state and acknowledgement separate. Background working→idle must produce Done, even without an explicit done report.
3. Map error to Blocked, support clear, and prevent child records from replacing root status.
4. Handle capability discovery before claiming reporter compatibility. Validate with a real reporting agent as well as synthetic OSC output.
5. Keep status independent of known agent names. Process detection remains useful for icons and resume behaviour.
6. Y-Term's current single-client tabs can use local acknowledgement; Herdr's daemon, shared labels, remote machines, and team sidebar are unnecessary for the requested feature.

No evidence in the inspected repositories establishes that any particular installed Claude Code or Codex version emits OSC 7501 automatically. Their brand strings in parser fixtures are examples, not compatibility proof. Any required agent integration must be investigated separately.
