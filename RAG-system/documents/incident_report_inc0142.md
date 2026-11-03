# Meridian Systems — Security Incident INC-0142 (Post-Mortem)

*Document ID: MS-SEC-011 · Clearance: L3 (HR_Manager only) · CONFIDENTIAL*

## Summary

INC-0142 involved a misconfigured object-storage bucket that exposed 3,112
internal support transcripts for 41 hours between March 2 and March 4, 2025.
An automated crawler discovered the exposure and triggered the response plan.

## Root cause

A manual IAM change bypassed peer review because the change author held the
same role as the reviewer on an on-call rotation. The guardrail that requires
two distinct principals approved the change — it was the same person with two
accounts.

## Customer impact

notification letters went to all 14 affected customers within the 72-hour
regulatory window. Two customers exercised their audit rights; both renewals
were preserved.

## Remediation

Peer review now requires distinct human principals verified by hardware keys.
Bucket policies are tested against a nightly linter, and the configuration
that caused the exposure was added to the pre-production regression suite.
