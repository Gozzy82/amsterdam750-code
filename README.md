# Amsterdam 750 — Registration on Azure

An independent pre-registration prototype using Azure Functions, Table Storage and Key Vault. It explores how to handle traffic spikes, protect personal data and keep the registration flow simple.

This is a personal engineering project, **not the official Amsterdam 750 ticketing system**. The companion case study explains the design and publishes synthetic load-test results with their methodology and limitations.

[Case study and load-test evidence](https://gozzy82.github.io/amsterdam750-public/) · [Portfolio](https://gerko.amsterdam/) · [LinkedIn](https://nl.linkedin.com/in/gerko-schrieken-b1853246)

This repository is a **sanitized public source snapshot** of the implementation. It contains application code and infrastructure definitions, without private development history or operational data.

## Main components

- Azure Functions split into public and privileged/admin responsibilities
- application-level PII protection and Key Vault integration
- Azure Table Storage and queue-based asynchronous processing
- HTMX-based progressive enhancement for a form-heavy workflow
- rate limiting, uniqueness controls and anti-abuse measures
- Infrastructure as Code with Bicep
- automated tests around shared security and application behavior

## Where to start

| Area | Source |
| --- | --- |
| Public pre-registration API | [`apps/functions-public/`](apps/functions-public/) |
| Administration and invitation processing | [`apps/functions-admin/`](apps/functions-admin/) |
| Browser UI and HTMX flow | [`apps/web/`](apps/web/) |
| Shared domain and security code, including PII encryption | [`packages/shared/`](packages/shared/) |
| Azure infrastructure definitions | [`infra/`](infra/) |
| Workspace commands | [`package.json`](package.json) |

## Security and publication scope

This is intentionally a **sanitized public snapshot**, created from the private development repository without carrying over its Git history.

It excludes production exports, deployment drift files, local settings, credentials, personal project notes and other operational material that is not needed to review the engineering approach.

Example configuration files use placeholders or local development values. Do not commit real secrets, connection strings or personal data.

## Run locally

Requirements:

- Node.js
- Azure Functions Core Tools for running the Function Apps
- Azurite when using the development-storage configuration

Install dependencies:

```bash
npm install
```

Run individual components:

```bash
npm run start:web
npm run start:public
npm run start:admin
```

Run tests:

```bash
npm test
```

## Infrastructure

The `infra/` directory contains the Bicep source used to describe the Azure architecture. Generated ARM JSON, production drift output and environment-specific deployment state are deliberately not part of this public snapshot.

## Related project

The design decisions, security model and load-test evidence are explained in the companion engineering case study:

https://gozzy82.github.io/amsterdam750-public/
