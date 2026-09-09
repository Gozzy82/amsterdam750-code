# Amsterdam 750 — Public Code Snapshot

This repository is a sanitized portfolio snapshot of the implementation behind the Amsterdam 750 engineering case study.

**Case study:** https://gozzy82.github.io/amsterdam750-public/

## What this code demonstrates

- Azure Functions split into public and privileged/admin responsibilities
- application-level PII protection and Key Vault integration
- Azure Table Storage and queue-based asynchronous processing
- HTMX-based progressive enhancement for a form-heavy workflow
- rate limiting, uniqueness controls and anti-abuse measures
- Infrastructure as Code with Bicep
- automated tests around shared security and application behavior

## Repository structure

```text
apps/
  web/               browser UI and HTMX flow
  functions-public/  public pre-registration API
  functions-admin/   privileged administration and invitation processing
packages/
  shared/             shared domain/security code, including PII encryption
infra/
  main.bicep          production-oriented Azure architecture
  testing.bicep       isolated testing environment
  bootstrap.bicep     bootstrap resources
  modules/            reusable Bicep modules
```

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

The design decisions, security model and verified load-test evidence are explained in the companion engineering case study:

https://gozzy82.github.io/amsterdam750-public/
