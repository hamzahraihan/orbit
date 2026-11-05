### Maintenance

- Extract module-level transcript cache state into `ConversationCache` singleton in `server/conversation-cache.ts`
- `answerVersion()` delegates to `conversationCache.processVersion`
- `forgetTranscriptState()` → `conversationCache.clear()`
- Remove dead instance methods and duplicated `PI_PAGE_CACHE_BYTES`
