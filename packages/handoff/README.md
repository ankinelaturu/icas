# @icas/handoff

Human-in-the-loop intervention requests, ownership state, pause/takeover/resume.

`SessionHandoffController.request` sets owner to `human`. `waitForResume` returns to `automation` after `signalResume` (tests inject resume; CLI waits on stdin).

`promptForApproval` and `promptForValue` read stdin and append `actor: human` evidence. Tests stub stdin with `Readable.from`.
