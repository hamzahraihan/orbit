### Maintenance

- Split `server/conversation.ts` into one transcript provider per source behind a shared `TranscriptProvider` contract (`server/conversation-providers.ts`); the hub delegates instead of branching on the pane's agent
- Extract the shared transcript vocabulary to `server/conversation-shared.ts`, the generic reader to `server/conversation-reader.ts`, and Claude's parsing to `server/claude-transcript.ts`
- `paneTranscript`, `openPaneConversation`, `paneConversation`, `toolOutput` and `conversationImage` take one `TranscriptSources` object instead of positional store paths
