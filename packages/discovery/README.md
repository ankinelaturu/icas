# @icas/discovery

LLM-driven discovery, bounded DFS search, trace recording, and trace-to-capability compilation.

The model does not return prose. It returns a `CandidateProposal` (`status` + ranked `candidates`). ICAS owns search state; Mastra is the proposer layer only (later passes).
