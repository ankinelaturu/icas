# @icas/handoff

Human-in-the-loop intervention requests, ownership state, pause/takeover/resume.

`SessionHandoffController.request` sets owner to `human`. `waitForResume` returns to `automation` after `signalResume` (tests inject resume; later passes wait on stdin).
