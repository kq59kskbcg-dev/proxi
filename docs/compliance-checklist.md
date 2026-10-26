# Proxi: regulated-industry architecture checklist

Proxi is a demo AI assistant built as if it were going to be sold to a regulated payments company (an EU-licensed bank-grade payment processor). The goal is to meet as many of the **technical and architectural** requirements of that kind of buyer as possible.

Organisational requirements (audits, certifications, legal contracts, staff training) are listed at the end for completeness, but they are out of scope: Proxi is not a real company.

**Status key:** ✅ done · 🟡 partly done · 🔲 planned

**Frameworks referenced:** PCI DSS (card data), DORA (EU digital operational resilience for financial entities and their ICT suppliers), GDPR (EU privacy), SOC 2 and ISO 27001 (security controls), EU AI Act, OWASP Top 10 and OWASP Top 10 for LLM Applications.

---

## Target architecture

```
Browser (static app)
   │  HTTPS only, strict CSP, no third-party requests
   ▼
EU edge / load balancer (WAF, rate limiting, TLS 1.2+)
   │
   ▼
API service (EU region, private subnets)
   ├─ Auth: OIDC / SAML SSO, short-lived sessions
   ├─ Input checks: PII and card-number redaction before the model
   ├─ Audit log (append-only, tamper-evident)
   │
   ▼  private endpoint, no public internet
Claude on AWS Bedrock (EU region)
   └─ No training on customer data, no prompt storage by the provider
```

Everything runs in one cloud provider and EU regions only, so there is one vendor to assess and a clear exit plan.

---

## 1. Data residency and sovereignty

| Control | How Proxi meets it | Framework | Status |
|---|---|---|---|
| All processing in the EU | API and model calls pinned to EU regions (Bedrock EU) | GDPR, DORA | 🔲 |
| No data leaves the customer's cloud | Option to deploy the API and Bedrock access inside the customer's own AWS account | DORA | 🔲 |
| Model provider does not train on data | Bedrock / Anthropic API commercial terms: inputs and outputs are not used for training | GDPR, EU AI Act | 🔲 |
| No third-party calls from the browser | Self-host fonts and scripts (today the page loads Google Fonts and Vue from a CDN, which leaks visitor IPs) | GDPR | 🔲 |
| Documented subprocessor list | `docs/subprocessors.md` listing every service that touches data, with region | GDPR | 🔲 |

## 2. Identity and access

| Control | How Proxi meets it | Framework | Status |
|---|---|---|---|
| Single sign-on | OIDC / SAML login via the customer's identity provider | SOC 2, ISO 27001 | 🔲 |
| MFA enforced | Delegated to the identity provider; app rejects sessions without an MFA claim | PCI DSS, SOC 2 | 🔲 |
| Short-lived sessions | Secure, HttpOnly, SameSite cookies; idle timeout and absolute expiry | OWASP, PCI DSS | 🔲 |
| Role-based access | Admin / member / auditor roles; least privilege by default | SOC 2, ISO 27001 | 🔲 |
| Least-privilege cloud access | API runs under a narrowly scoped IAM role that can only invoke the chosen models | ISO 27001 | 🔲 |

## 3. Encryption and secrets

| Control | How Proxi meets it | Framework | Status |
|---|---|---|---|
| Encryption in transit | HTTPS everywhere, HSTS with preload, TLS 1.2+ only | PCI DSS, SOC 2 | 🟡 GitHub Pages serves HTTPS; HSTS preload not set |
| Encryption at rest | Any stored data encrypted with customer-managed keys (KMS) | PCI DSS, DORA | 🔲 |
| No secrets in the browser or repo | API keys only in the server's secret store; secret scanning on every push | OWASP, SOC 2 | 🟡 No secrets exist yet; scanning not enabled |
| Key rotation | Automated rotation of credentials and keys | PCI DSS | 🔲 |

## 4. Privacy by design

| Control | How Proxi meets it | Framework | Status |
|---|---|---|---|
| Data minimisation | Server is a pass-through: it does not store chat content | GDPR | 🔲 |
| Chats stay with the user | Conversation history kept in the browser only, with a "delete all" button | GDPR | 🟡 History is in memory only today, nothing persists |
| No tracking | No analytics, ads or third-party cookies | GDPR, ePrivacy | ✅ |
| Configurable retention | If an org enables history, it auto-deletes after a set period | GDPR | 🔲 |
| Data subject rights | Export and erase a user's data on request | GDPR | 🔲 |
| Privacy page that matches reality | Privacy section in the app describes exactly what is built, nothing more | GDPR | 🔲 |

## 5. Payment data (stay out of PCI scope)

| Control | How Proxi meets it | Framework | Status |
|---|---|---|---|
| Never store card numbers | No database field or log line can hold message content | PCI DSS | 🔲 |
| Detect and redact card numbers | Card numbers (Luhn-checked) and IBANs masked before they reach the model or any log | PCI DSS, GDPR | 🔲 |
| Warn the user | Composer shows a notice when a card number is detected | PCI DSS | 🔲 |

## 6. AI and LLM safety

| Control | How Proxi meets it | Framework | Status |
|---|---|---|---|
| Prompt injection defences | System prompt isolated from user content; model has no tools that can act or leak data | OWASP LLM01 | 🔲 |
| Output handling | Model output rendered as text, never as HTML, so it can't inject scripts | OWASP LLM02 | 🟡 Messages render as plain text today |
| Abuse and cost limits | Per-user rate limits, max tokens per request, daily spend cap | OWASP LLM10 | 🔲 |
| Transparency | Users always know they are talking to an AI, and that it can make mistakes | EU AI Act | ✅ "Proxi can make mistakes" notice |
| Model and version pinned | Exact model IDs pinned in config, changes go through review | SOC 2 change management | 🔲 |
| Human feedback loop | Thumbs up / down recorded without storing message content | EU AI Act | 🟡 Buttons exist, nothing recorded |

## 7. Web application hardening

| Control | How Proxi meets it | Framework | Status |
|---|---|---|---|
| Strict Content Security Policy | Only same-origin scripts, no inline scripts, no `eval` | OWASP | 🔲 Needs a precompiled build (today Vue compiles templates in the browser) |
| Security headers | HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors none | OWASP | 🔲 Not possible on GitHub Pages |
| Subresource integrity | Every external file pinned by hash, or everything self-hosted | OWASP, supply chain | 🔲 |
| Clickjacking protection | `frame-ancestors 'none'` | OWASP | 🔲 |
| Accessibility | 44px touch targets, labels, keyboard focus, reduced motion | EU Accessibility Act | ✅ |

## 8. Logging, monitoring and audit

| Control | How Proxi meets it | Framework | Status |
|---|---|---|---|
| Audit log | Who did what and when (sign-in, settings changes, deletions), no chat content | SOC 2, DORA | 🔲 |
| Tamper-evident logs | Append-only storage with object lock | PCI DSS, DORA | 🔲 |
| Alerting | Alerts on error spikes, auth failures and unusual spend | DORA, SOC 2 | 🔲 |
| No sensitive data in logs | Structured logging with an allow-list of fields | PCI DSS, GDPR | 🔲 |

## 9. Resilience (DORA)

| Control | How Proxi meets it | Framework | Status |
|---|---|---|---|
| Infrastructure as code | Whole stack defined in Terraform or CDK; reproducible in a new account | DORA, SOC 2 | 🔲 |
| Multi-zone deployment | API runs across at least two availability zones | DORA | 🔲 |
| Model fallback | If one model or region is unavailable, fall back to another EU option | DORA | 🔲 |
| Exit plan | Documented way to move off each vendor, with the model access behind one interface | DORA | 🔲 |
| Incident runbook | `docs/incident-response.md`: detect, contain, notify, review | DORA, SOC 2 | 🔲 |

## 10. Secure development and supply chain

| Control | How Proxi meets it | Framework | Status |
|---|---|---|---|
| Code review on main | Branch protection, required review, no direct pushes | SOC 2 change management | 🔲 |
| Dependency scanning | Dependabot alerts and updates | OWASP, supply chain | 🔲 |
| Static analysis | CodeQL on every pull request | SOC 2 | 🔲 |
| Secret scanning | GitHub secret scanning and push protection | SOC 2 | 🔲 |
| Pinned dependencies | Exact versions and a lockfile | Supply chain | 🟡 Vue pinned to 3.4.38, no lockfile yet |
| Automated tests in CI | Browser tests for the UI, unit tests for redaction and auth | SOC 2 | 🔲 |
| Security policy | `SECURITY.md` explaining how to report a vulnerability | ISO 27001 | 🔲 |

---

## Out of scope: organisational requirements

A real vendor to a payments company would also need these. They need a real company, people and auditors, so this demo only notes them.

- SOC 2 Type II and ISO 27001 certification
- PCI DSS assessment (avoided here by keeping card data out of scope)
- Signed data processing agreement, DORA contract clauses and right to audit
- Annual third-party penetration test
- Background checks, security training and access reviews for staff
- Business continuity testing and cyber insurance
- EU AI Act risk classification and documentation

---

## Showing the evidence

Each ✅ should be provable, not just claimed:

- **Headers and TLS:** screenshots from securityheaders.com and SSL Labs (aim for A+)
- **No third parties:** browser network tab showing only same-origin requests
- **Redaction:** unit tests with sample card numbers and IBANs
- **Infrastructure:** the Terraform or CDK code in this repo
- **Process:** branch protection settings, CI runs and Dependabot history
