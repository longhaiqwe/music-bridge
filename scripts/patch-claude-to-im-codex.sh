#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="${SKILL_DIR:-$HOME/.codex/skills/claude-to-im}"

cd "$SKILL_DIR"

cp src/codex-provider.ts src/codex-provider.ts.bak
cp src/store.ts src/store.ts.bak
cp config.env.example config.env.example.bak

if ! rg -q "CTI_CODEX_CONFIG_JSON" src/codex-provider.ts; then
  perl -0pi -e 's/function shouldPassModelToCodex\(\): boolean \{\n  return process\.env\.CTI_CODEX_PASS_MODEL === '\''true'\'';\n\}\n/function shouldPassModelToCodex(): boolean {\n  return process.env.CTI_CODEX_PASS_MODEL === '\''true'\'';\n}\n\nfunction shouldSkipGitRepoCheck(): boolean {\n  return process.env.CTI_CODEX_SKIP_GIT_REPO_CHECK === '\''true'\'';\n}\n\nfunction readCodexConfigOverride(): Record<string, unknown> | undefined {\n  const raw = process.env.CTI_CODEX_CONFIG_JSON?.trim();\n  if (!raw) return undefined;\n\n  try {\n    const parsed = JSON.parse(raw);\n    if (parsed && typeof parsed === '\''object'\'' && !Array.isArray(parsed)) {\n      return parsed as Record<string, unknown>;\n    }\n    console.warn('\''[codex-provider] CTI_CODEX_CONFIG_JSON must be a JSON object; ignoring override'\'');\n  } catch (error) {\n    const message = error instanceof Error ? error.message : String(error);\n    console.warn(`\[codex-provider\] Failed to parse CTI_CODEX_CONFIG_JSON: ${message}`);\n  }\n\n  return undefined;\n}\n/s' src/codex-provider.ts

  perl -0pi -e 's/    const baseUrl = process\.env\.CTI_CODEX_BASE_URL \|\| undefined;\n\n    const CodexClass = this\.sdk\.Codex;\n    this\.codex = new CodexClass\(\{\n      \.\.\.\(apiKey \? \{ apiKey \} : \{\}\),\n      \.\.\.\(baseUrl \? \{ baseUrl \} : \{\}\),\n    \}\);/    const baseUrl = process.env.CTI_CODEX_BASE_URL || undefined;\n    const config = readCodexConfigOverride();\n\n    const CodexClass = this.sdk.Codex;\n    this.codex = new CodexClass({\n      ...(apiKey ? { apiKey } : {}),\n      ...(baseUrl ? { baseUrl } : {}),\n      ...(config ? { config } : {}),\n    });/s' src/codex-provider.ts

  perl -0pi -e 's/            const threadOptions: Record<string, unknown> = \{\n              \.\.\.\(passModel && params\.model \? \{ model: params\.model \} : \{\}\),\n              \.\.\.\(params\.workingDirectory \? \{ workingDirectory: params\.workingDirectory \} : \{\}\),\n              approvalPolicy,\n            \};/            const threadOptions: Record<string, unknown> = {\n              ...(passModel && params.model ? { model: params.model } : {}),\n              ...(params.workingDirectory ? { workingDirectory: params.workingDirectory } : {}),\n              ...(shouldSkipGitRepoCheck() ? { skipGitRepoCheck: true } : {}),\n              approvalPolicy,\n            };/s' src/codex-provider.ts
fi

if ! rg -q "CTI_CODEX_CONFIG_JSON" config.env.example; then
  perl -0pi -e 's/# CTI_CODEX_API_KEY=\n# CTI_CODEX_BASE_URL=\n/# CTI_CODEX_API_KEY=\n# CTI_CODEX_BASE_URL=\n# Pass raw Codex CLI config overrides through the SDK.\n# Example:\n# CTI_CODEX_CONFIG_JSON={"sandbox_workspace_write":{"writable_roots":["\/path\/to\/your\/repo\/.git"],"network_access":false}}\n# CTI_CODEX_CONFIG_JSON=\n# Skip Codex'\''s Git repository preflight for non-repo paths.\n# CTI_CODEX_SKIP_GIT_REPO_CHECK=false\n/s' config.env.example
fi

if ! rg -q "sessionChanged" src/store.ts; then
  perl -0pi -e 's/    if \(existing\) \{\n      const updated: ChannelBinding = \{\n        \.\.\.existing,\n        codepilotSessionId: data\.codepilotSessionId,\n        workingDirectory: data\.workingDirectory,\n        model: data\.model,\n        updatedAt: now\(\),\n      \};/    if (existing) {\n      const sessionChanged = existing.codepilotSessionId !== data.codepilotSessionId;\n      const updated: ChannelBinding = {\n        ...existing,\n        codepilotSessionId: data.codepilotSessionId,\n        ...(sessionChanged ? { sdkSessionId: '\'''\'' } : {}),\n        workingDirectory: data.workingDirectory,\n        model: data.model,\n        updatedAt: now(),\n      };/s' src/store.ts
fi

npm run build
