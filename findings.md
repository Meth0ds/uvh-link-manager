# Findings & Decisions

## Settings redesign — 2026-09-14
- Rebuilt identity masthead, profile/name form, email row and three visual theme choices; flattened nested panels into ruled sections. Current tokens and user commits preserved.
- Local fragment links were resolving against the root base href. Local jump handler now keeps the settings route and moves keyboard focus without unmounting security forms.
- Sessions read failure no longer displays a misleading zero-count badge. All existing security mutation methods retained.
- Isolated browser: profile mobile/light and security mobile/dark at 320px have no horizontal overflow; 768/1024/1440 checked in both themes. Name save, email confirmation and destructive actions were not submitted.
- Settings preview uses fictional data, explicit decoded read fixture and rejecting mutation methods. Error states show retry rather than empty-success counts.

## Requirements
Continue the redesign, inspect and preserve the user's newer commits; change existing work only where useful.

## Research Findings
- Workspace real modal at 320/light: labelled name field initially focused, no overflow in screenshot, create disabled. Name hint and workspace selector explanation wrap correctly. This is non-destructive creation; no request submitted.
- Invitation desktop/dark screenshot verified with explicit accept/reject consequences; mobile error distinguishes switching account from local discard. Only fixture scenario buttons used, no accept/reject/logout.
- MFA isolated preview mobile/light: fields, recovery explanation and disabled continue button fit; Enter opens the native help disclosure with visible focus. No password or factor was entered.
- Phase 6: workspace validator previously accepted padded one-character/blank names while the API payload trims. Added matching trimmed minimum, visible Material error and dynamic hints. MFA and invitation pages retain their auth/token contracts; pending invitation no longer looks like a login failure, and recovery-code help is explicit.
- List viewer has no New webhook control. Empty copy identifies roles able to configure; simulated failure and loading remain distinct. Rapid desktop-to-mobile resizing again yields transient shell widths; not accepted as steady-state overflow evidence.
- Dark/mobile shared confirmation screenshot verified, canceled without deletion. Edit form shows preserve-current-secret guidance. Dark form client/scroll match at 320/768/1024/1440, including dynamic multi-line hints.
- Current worktree advanced to 8b03b83 (user commits cf5375a/8b03b83 incorporate prior design edits). Preserved new RedirectService/docs edits. This agent did not commit them.
- Webhook accordion opens via Enter; real shared delete dialog tested with fictional data, width 294.4px at viewport 320 and initial focus Cancelar. Final destructive action not taken.
- Webhook form at 320px: main client/scroll 310/310; Space selects the native event checkbox. Added dynamic Material hint sizing so multi-line secret guidance participates in layout rather than overlapping actions.
- Phase 5 preview shows labelled creation form and five described events; no credential entered. Preview intentionally recreates its single component on scenario changes (Angular NG0956 warning, not a production route).
- Phase 5: backend update preserves the current signing secret when omitted (WebhookController update); previous form copy incorrectly promised generation. List lacked viewer capability gating and live region contained the secret. Corrected presentation and entry guards; confirmed deletions now check the original workspace after awaiting the dialog.
- Final inspector mobile/light after layout settles: main client/scroll 310/310; screenshot readable, no persistent overflow. Rapid breakpoint changes briefly exposed intermediate shell widths, so this batch does not certify animation frames. Browser viewport reset.
- Inspector steady dark/mobile screenshot verified: filtered payload wraps, error message and focus ring visible, actions fit. Viewer workspace hides ping/resend; empty copy asks an editor; simulated read failure has no empty state; loading remains explicit. No write controls were activated.
- Inspector light/desktop renders endpoint summary and ruled delivery ledger. Native payload disclosure responds to Enter. Long unbroken event IDs and URL fit at 320px; main client/scroll 310/310 after responsive settling. One screenshot captured the shared theme transition mid-animation, so steady-state screenshot remains required.
- /status: both themes measured at 320/768/1024/1440; steady-state document client/scroll match. Theme transition briefly measured 10px extra scroll at desktop, then settled to 1430/1430. Enter opens the reading guide; skip link focuses service-status.
- Fixed preview scenario selection with a signal, confirmed after reload: outage shows only webhooks interrupted; valid unknown and transport error show unknown without empty service lists; pending shows neutral loading. Dark mobile 320: client/scroll 310/310.
- Focused ChromeHeadless suite: 16/16 passing, exit 0. Production build: pass, initial 496.22 kB. These tests use doubles; no external monitor or receiver is validated.
- Status desktop/light screenshot shows the new wordmark, readable headline, measured status plate and ruled component strip. Mobile/dark at 320px fits; checking scenario toolbar updates before accepting state coverage.
- Status/inspector implementation and isolated fixtures assembled. Types and targeted ESLint passed (exit 0). Preview navigation initially timed out while Vite initialized; fresh DOM confirmed the status page loaded, so no duplicate navigation was needed.
- Resumed with additional unrelated backend and frontend/eslint.config.js edits in the worktree; preserved them. Inspector runtime mutations remain unchanged; buttons additionally disable during failed/incomplete reads.
- Continuation: previous turn made verified progress (403/404/Tokens). Current worktree retains those edits; no new user commits observed.
- /status still uses uppercase UVH arrow mark, lacks a theme control, and displays backend unavailable snapshots with an empty components region. Use explicit unknown presentation for both failed reads and valid unknown projections.
- Inspector exposes raw English delivery statuses and says to send a ping even to a read-only viewer. Payload summary has a small hit area; record wrapping/pagination need narrow-width work. Preserve payload allowlist and API mutation methods.
- Clean main at a9e69db, September 12. Recent commits cover team, activity, usage, status/errors, admin and shared primitives.
- fdf0982 removes inherited card shadows and establishes 3px panel geometry. Preserve this deliberate refinement.
- a9e69db rewrites README and design-system.md; the September 8 checkpoint is stale, not current evidence of remaining pages.
- Tokens .create-card .create-fields .expires has specificity 0,3,0 versus mobile .create-fields .expires 0,2,0, so 240px wins. Name field also lacks full-width mobile sizing.
- Tokens mobile .token-actions combines width:100% and margin-left:50px, exceeding its row width.
- Long token names and displayed secrets need min-width:0 and wrapping; MFA label is longer than the narrow field.

## Technical Decisions
Keep actual component methods, scope values, credential constraints, confirmations and request isolation unchanged. Use real component + fictional decoded read responses for presentation checks only.

## Resources
docs/design-system.md; .agents/skills/uvh-editorial-design/SKILL.md; frontend/src/app/panel/tokens/; frontend/design-preview/.

## Visual/Browser Findings
- Token preview renders decoded metadata, five scopes and disabled issuance without credentials. All writes still rejected.
- User explicitly expanded this batch to rebuild 403/404. Current surface has old uppercase UVH arrow logo, no theme toggle and only generic return guidance.
- Do not echo requested URL/query/fragment on error pages: these may carry bearer links. Do not infer ownership or resource existence for 403.
- Tokens at 320px dark: document width/scroll 320/320, inner main client/scroll 310/310. Form controls fit; long-name fixture is retained for registry inspection.
- 404 mobile composition renders large code, distinct explanation, primary return action, help and useful guidance. No route reflection. Desktop/light verification in progress.
- 404 desktop/light: 1440px viewport, 1430px document, readable two-column composition and three guidance columns. Material icons render after font load.
- 403 desktop/dark: distinct warning color/copy; keyboard skip moves focus to status-content without navigation. Theme transition remains shared with public pages.
- 403 widths 1024/768/320 report document scroll widths 1014/758/310, no horizontal overflow.
- Tokens mobile/light registry: long unbroken name wraps; actions stay between x68 and x204, main scroll/client widths both 310. Space toggles links:read, verified by AX checked state and focus, without submitting.
- One locator evaluation timed out after Space during navigation. Fresh AX confirmed action succeeded; no repeat click performed.
- Tokens 768/1024/1440: no document or main horizontal overflow in measured layouts. Error shows retry; empty explicitly says tokens are optional for panel use; pending state announces Cargando tokens. Returning to populated cancels the pending fixture and renders correctly.
- 404 additionally verified light at 1024/768/320 (scroll 1014/758/310); mobile screenshot shows all primary actions within width. Viewport reset before handoff.
