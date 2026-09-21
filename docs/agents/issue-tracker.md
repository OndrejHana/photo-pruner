# Issue tracker: GitHub

Issues live in [OndrejHana/photo-pruner](https://github.com/OndrejHana/photo-pruner/issues). Use the authenticated `gh` CLI from this repository. Use exact multiline text in a temporary file with `--body-file` for issue bodies and comments; do not interpolate prose into shell commands.

PRs as a request surface: **no**.

## Wayfinding operations

- A map is an issue labelled `wayfinder:map`. Find it with `gh issue list --label wayfinder:map --state open`.
- Tickets are native GitHub sub-issues of the map, labelled `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. Create only labels currently needed.
- Create all tickets before wiring their relationships. Get an issue's numeric database ID with `gh api repos/OndrejHana/photo-pruner/issues/NUMBER --jq .id`.
- Add a child with `gh api --method POST repos/OndrejHana/photo-pruner/issues/MAP_NUMBER/sub_issues -F sub_issue_id=CHILD_DATABASE_ID`.
- List the children in map order with `gh api --paginate repos/OndrejHana/photo-pruner/issues/MAP_NUMBER/sub_issues`.
- Blocking uses native GitHub issue dependencies. Add a blocker with `gh api --method POST repos/OndrejHana/photo-pruner/issues/TICKET_NUMBER/dependencies/blocked_by -F issue_id=BLOCKER_DATABASE_ID`.
- Read blockers with `gh api --paginate repos/OndrejHana/photo-pruner/issues/TICKET_NUMBER/dependencies/blocked_by`. A ticket is unblocked when none of these blockers is open.
- The frontier is the map's open children with no open blockers and no assignees. Preserve child order when choosing the next ticket; fetch each child's issue metadata and blockers to determine eligibility.
- Claim before doing work: `gh issue edit NUMBER --add-assignee @me`. The authenticated developer's assignment is the claim. Charting does not claim tickets.
- Resolve by posting the answer as a resolution comment, closing the child, and adding a named link with a one-line gist to the map's Decisions-so-far. Keep the detailed answer only on its ticket.
- Add newly exposed tickets and native dependencies as the route becomes clearer. Never resolve a ticket in the same session that charts the map, and resolve at most one ticket per subsequent session.

Always refer to maps and tickets by their linked titles in human-facing text. Open children are discovered by query, not duplicated as a list in the map body. Keep the agreed scope in the map's Notes; do not reinterpret prototype behavior as a user decision.

API references: [sub-issues](https://docs.github.com/en/rest/issues/sub-issues), [issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies).
