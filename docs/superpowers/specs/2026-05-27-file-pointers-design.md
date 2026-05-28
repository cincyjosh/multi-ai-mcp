# Plan: Transition from Content Embedding to File Pointing

## Objective
Update the `multi-ai-mcp` tools to stop embedding the full content of requested files directly into the prompt. Instead, provide the file paths to the model and authorize the underlying CLI tools to read them by adding their parent directories to the CLI's allowed list. This will eliminate the 100KB file limit and 500KB total context limit, letting the agents use their own tools (e.g. `read_file`, `grep`) to read the files efficiently.

## Key Files & Context
- `src/utils/prompt_builder.ts`: Contains the current `buildFileContext` logic which reads file contents and enforces size limits.
- `src/tools/consult_gemini.ts`: Wraps the `gemini` CLI. Uses `--include-directories`.
- `src/tools/consult_claude.ts`: Wraps the `claude` CLI. Uses `--add-dir`.
- `src/tools/consult_codex.ts`: Wraps the `codex` CLI. Uses `--add-dir`.
- `tests/utils/prompt_builder.test.ts`: Tests file size limits and content embedding which will need updating.

## Implementation Steps

1. **Update `src/utils/prompt_builder.ts`:**
   - Modify `buildFileContext` to return an object with two properties: `prompt` (string) and `directories` (string[]).
   - The `directories` array will contain the unique, validated parent directories of all requested files.
   - The `prompt` string will list the file paths (e.g., "The following files are relevant to this request and are accessible in your environment. Use your tools to read them if necessary:\n- /path/to/file1.txt").
   - Continue using `resolvePathSafe` to validate the file paths, but REMOVE `readFileContent` and the size limits (`MAX_FILE_BYTES`, `MAX_TOTAL_BYTES`).

2. **Update `src/tools/consult_gemini.ts`:**
   - Update the call to `buildFileContext` to receive the new object.
   - Append the returned `directories` to `dirArgs` using the `--include-directories` flag.

3. **Update `src/tools/consult_claude.ts`:**
   - Update the call to `buildFileContext`.
   - Append the returned `directories` to the `addDirs` array (which is later added via the `--add-dir` flag).

4. **Update `src/tools/consult_codex.ts`:**
   - Update the call to `buildFileContext`.
   - Append the returned `directories` to `dirArgs` using the `--add-dir` flag (note: Codex uses `-C` for the primary directory and `--add-dir` for additional ones).

5. **Update Tests:**
   - Modify `tests/utils/prompt_builder.test.ts` to expect the new return shape (`{ prompt, directories }`).
   - Remove tests related to `MAX_FILE_BYTES` and `MAX_TOTAL_BYTES` since the limits are no longer applicable.

## Verification & Testing
- Ensure `npm run build` succeeds.
- Run `npm test` to verify `prompt_builder.test.ts` passes with the new logic.
- Verify path traversal security is maintained because `buildFileContext` will still use `resolvePathSafe`.