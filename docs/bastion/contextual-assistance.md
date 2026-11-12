# Contextual assistance: cases and source inputs

Milestone 7 extends `fork/editor-context/editor-runtime-assistance` and its existing editor hint, dismissal and command recovery. It does not add a competing suggestion store or autonomous agent. Completion, contextual review and full investigations remain separate.

## Source-pluggable case contract

`assistance-cases.ts` exports `AssistanceInput<T>`, `AssistanceInputs<Sources>`, `AssistanceCase<Sources, Output>` and `firstCurrentAssistanceCase`. Each case names its `inputs`, has a stable `id`, and returns a proposal or null. Its evaluator is a pure function: no reads, processes, model requests or execution. Cases are trusted internal application code, not an arbitrary plugin execution interface.

Source owners provide `{ current, revision, value }`. Missing or non-current declared inputs skip the case entirely. The evaluator receives only its declared inputs. The first applicable case wins in explicit array order; insert specific new cases before the explicit-file-review fallback. Its signature includes only its ID and declared source revisions, never input values. A changed revision invalidates a dependent draft. Global file/workspace/owner/runtime/target guards also apply regardless of case inputs.

Current cases:

| Case                 | Declared inputs            | Purpose                                                                   |
| -------------------- | -------------------------- | ------------------------------------------------------------------------- |
| runtime-tooling      | editor, discovery, runtime | Review recognized CLI capability; an uninspected remote CLI stays unknown |
| editor-diagnostics   | editor, discovery          | Review bounded diagnostic counts; no diagnostic text is copied            |
| explicit-file-review | editor, discovery          | Keep explicit help available through the same hint and command deck       |

The source map is generic. A later milestone can extend `EditorAssistanceSources` with an existing owner's sanitized terminal, change-record or cloud-target input, then register a case declaring that key. Neither the generic evaluator nor existing cases need changing. No terminal run-record, dependency-binding or cloud-target model is implemented here. A source adapter must resolve the project owner, bound and sanitize its values, supply a revision, and report stale/unavailable input honestly. Raw terminal output and credential-bearing target objects must not become provider context merely because an input is available.

## Ownership and freshness

Discovery retains the existing local main-process inspection / remote runtime read split. A local inspection is returned transiently with its discovery snapshot; remote inspection remains null, so the hint cannot borrow this computer's tools. Secret-named files are excluded before mounting assistance.

The existing editor context now publishes model versions and marker updates. File edits, affected discovery paths, missing notifications, unknown owner, connection-health/generation changes and observed target changes invalidate the prepared preview. Reconnect refreshes owner-routed discovery. The existing local target reader includes the active Terraform directory and does not return the previous directory's cached context; remote target context remains unverified. Existing target observation is polling-based and is not an atomic cloud/session guarantee.

Dismissal remains stable across ordinary file edits. It is specific to the file, workspace and runtime/target identity; source updates and connection flaps do not nag the engineer again. The existing command deck restores explicit help. Secret-named files, selections, raw source, diagnostic messages, contract answers, absolute roots and target credentials are not copied into drafts. Only allowlisted relative-file metadata, CLI status, bounded counts and relevant evidence paths enter the generated text (maximum 2,400 characters).

## Provider handoff

A reviewed draft can be copied for any agent or appended to a selected compatible structured chat already open on the same project owner. The adapter checks current context, tab identity and host, refuses ambiguous cross-host conversation IDs, appends without replacing existing text and skips automatic editor-context attachment on the next send. It does not launch an agent, write terminal input or submit a message.

The preview blocks stale handoff. After handoff, text in the normal composer or clipboard is an ordinary human-owned draft; it is not a live execution record or a send-time source lock. Review it before sending. Existing explicit Claude tooling outside this hint is unchanged. Terminal-only/other providers use copy-only handoff; this does not advertise Cursor inline-completion or generic provider API compatibility.

## Validation and remaining scope

Linux development validation uses a disposable folder project and managed loopback Docker SSH host, with no paid inference or real cloud resources. Native composer routing is verified with mocked draft-store/owner tests; no signed-in provider session is created for proof. Rendered checks cover the preview, file-edit staleness, dismissal/recovery, owner-scoped remote CLI status and native drag hit areas. Detailed results are in `project-workspace-validation.md`; private evidence stays under `.handoff/step7-1112/`.

Dependency binding and failed-run verification cases await milestones 8–12. Low-latency completion, remote language servers, broader provider integrations and packaged/macOS/Windows/mobile validation remain open. Existing Step 5 and Step 6 support limits remain open.
