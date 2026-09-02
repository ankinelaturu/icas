# @icas/discovery

LLM-driven discovery, bounded DFS search, trace recording, and trace-to-capability compilation.

The model does not return prose. It returns a `CandidateProposal` (`status` + ranked `candidates`, including optional `possibleOutcomes`). Compile copies `error` / `hitl` onto the step and drops `kind: "success"`. ICAS owns search state and the ranking prompt (`proposer-prompt.ts`). Mastra is the `generate` adapter only.
