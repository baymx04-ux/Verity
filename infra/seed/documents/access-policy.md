# Access Policy

Verity stores company knowledge in access-controlled workspaces. Every document has one of three access levels.

## Public
Public documents are readable by every signed-in role, including viewers. Use public for handbooks, published policies, support playbooks, and marketing material.

## Internal
Internal documents are readable by analysts and administrators. Viewers cannot open or cite them. Use internal for operating procedures, architecture notes, and pricing guidance.

## Restricted
Restricted documents are readable only by administrators and by members of the groups explicitly granted access. A restricted document with no groups is effectively admin-only.

## Who can change access
Only administrators may change a document's title, access level, or group grants. Analysts upload documents as internal; they cannot widen access. Every change is recorded in the audit log with the acting user, timestamp, and previous value.

## Reviews
Administrators review restricted grants quarterly. Remove grants when a project ends, when an employee changes teams, or when a vendor relationship terminates. Suspected exposure must be reported within one business day and handled under the incident response policy.
