# Security Policy

## Threat model (read this first)

Dispatch is one user, one machine, localhost only. Everything binds to `127.0.0.1`, and there is no
authentication layer, on purpose. ttyd hands out a shell attached to a live agent session, so the
security boundary is your machine's loopback interface, not a login.

This shapes what is and isn't a vulnerability:

- **Out of scope (by design):** "there's no auth," "the terminal is unauthenticated," "anyone on the
  network can connect." Dispatch is not meant to be reachable from a network. Don't expose it, and don't
  report the absence of auth as a bug. It's documented behavior.
- **In scope:** anything that lets code escape the loopback assumption or exceed the intended trust
  boundary. For example: a binding that isn't actually loopback-only, agent or ticket content that can
  execute outside its session or read files it shouldn't, config/secret leakage (e.g. your Linear API
  key ending up somewhere unexpected), or a path that lets a crafted Linear payload run commands you
  didn't intend.

If you're unsure which bucket something falls in, report it privately and we'll sort it out.

## Reporting a vulnerability

**Please report privately. Don't open a public issue.**

Use GitHub's private vulnerability reporting:
[**Report a vulnerability**](https://github.com/theyashgupta/dispatch/security/advisories/new).

If you can't use that, email **yashguptaab66@gmail.com** with "Dispatch security" in the subject.

Please include:

- What the issue is and the trust boundary it crosses.
- Steps to reproduce, ideally against a default localhost setup.
- The version or commit SHA (`git rev-parse --short HEAD`).

You'll get an acknowledgement within a few days, even if it's just "thanks, looking into it." This is a
solo-maintained project, so fixes are best effort, but security reports jump the queue, and the aim is
to resolve verified issues within about 90 days. Once a fix ships, you'll be credited in the advisory
unless you'd rather stay anonymous.

## Supported versions

Dispatch is pre-1.0 and moves fast. Only the latest `main` is supported, so please confirm an issue
against current `main` before reporting.
