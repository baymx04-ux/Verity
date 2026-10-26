# Incident Response Policy

## Severity levels

- SEV1: confirmed exposure of customer data or a full production outage.
- SEV2: degraded service, credential compromise, or a high-risk vulnerability.
- SEV3: limited impact with a workaround.
- SEV4: low-risk operational issue.

## Response

The on-call engineer declares severity and opens an incident channel. The incident commander coordinates engineering, support, and communications. Preserve logs and avoid destructive cleanup until the timeline is captured.

## Notification

A confirmed breach affecting customer data must be escalated to the security lead and legal within one hour. Regulators and customers are notified according to contractual and legal deadlines. Do not speculate publicly about cause or scope.

## Recovery and learning

Restore service from a known-good state, verify data integrity, and monitor for recurrence. A blameless postmortem is due within five business days for SEV1 and SEV2 incidents. Track action items to completion and share the summary with leadership.
