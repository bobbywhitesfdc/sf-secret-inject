---
name: sf-secret-inject
description: Use this skill whenever working with the sf-secret-inject SF CLI plugin — storing secrets in the local keychain, injecting them into a Salesforce External Credential principal, or listing External Credentials in an org. Triggers on mentions of "sf secret inject", "sf secret store", "sf secret list", "External Credential secrets", "Named Credentials secret injection", "inject clientId/clientSecret into Salesforce", or any request to push secrets into an External Credential principal.
metadata:
  type: skill
  version: "0.0.1"
  last_updated: "2026-06-23"
---

# sf-secret-inject

`sf-secret-inject` is an SF CLI plugin that securely injects secrets into
Salesforce External Credential principals via the Named Credentials REST API.

Salesforce strips secrets from all Metadata API payloads by design — this plugin
provides the missing "Step 2": after `sf project deploy` creates the External
Credential structure, `sf secret inject` pushes the actual secret values.

## What it does at a glance

- **`sf secret store`** — writes a secret into the local system keychain
  (macOS Keychain, Linux `secret-tool`, Windows Credential Manager) under a
  scoped key `{orgAlias}.{ref}` so secrets across different orgs never collide.
- **`sf secret inject`** — reads an `.ec-inject.yaml` config file, resolves
  secrets from the system keychain or environment variables, and POSTs them
  to the Named Credentials REST endpoint. Automatically retries with PUT on
  CONFLICT (idempotent).
- **`sf secret list`** — queries the Tooling API and prints a table of all
  External Credentials and their principals in the target org.

## Salesforce prerequisites

Before `sf secret inject` can run successfully, three things must already exist
in the target org. If any are absent, the API call will fail with a NOT_FOUND or
INSUFFICIENT_ACCESS error.

### 1. Named Credential (the parent container)

A **Named Credential** wraps the External Credential and defines the callout
endpoint URL. It must be deployed before secrets can be injected.

```xml
<!-- force-app/main/default/namedCredentials/MyApiCred.namedCredential-meta.xml -->
<NamedCredential>
  <label>My API Credential</label>
  <namedCredentialType>SecuredEndpoint</namedCredentialType>
  <endpoint>https://api.example.com</endpoint>
  <externalCredential>MyApiCred</externalCredential>
</NamedCredential>
```

### 2. External Credential + Principal (the auth identity)

The **External Credential** defines the authentication protocol. The **Principal**
is the identity that will hold the injected secrets. Both are deployed via
metadata.

```xml
<!-- force-app/main/default/externalCredentials/MyApiCred.externalCredential-meta.xml -->
<ExternalCredential>
  <externalCredentialParameters>
    <authProvider><!-- OAuth provider, if used --></authProvider>
    <parameterGroup>MyPrincipal</parameterGroup>
    <parameterName>clientId</parameterName>
    <parameterType>AuthParameter</parameterType>
    <sequenceNumber>1</sequenceNumber>
  </externalCredentialParameters>
  <!-- ... additional parameters ... -->
  <label>My API Credential</label>
  <principals>
    <principalName>MyPrincipal</principalName>
    <principalType>NamedPrincipal</principalType>
    <sequenceNumber>1</sequenceNumber>
  </principals>
  <protocol>OauthClientCredentials</protocol>
</ExternalCredential>
```

The `credential` and `principal` values in `.ec-inject.yaml` must exactly match
the `DeveloperName` of the External Credential and the `principalName` of the
Principal in this metadata.

### 3. Permission Set with External Credential Principal Access

Users (and the running user for callouts) must be granted access to the
principal via a Permission Set. Without this, the callout authenticates but
Salesforce rejects it at runtime.

```xml
<!-- force-app/main/default/permissionsets/MyApiCred_Access.permissionset-meta.xml -->
<PermissionSet>
  <externalCredentialPrincipalAccesses>
    <enabled>true</enabled>
    <externalCredentialPrincipal>MyApiCred-MyPrincipal</externalCredentialPrincipal>
  </externalCredentialPrincipalAccesses>
  <label>MyApiCred Access</label>
</PermissionSet>
```

Assign the permission set to users who will execute callouts:

```
sf org assign permset --name MyApiCred_Access --target-org myOrg
```

---

## Key concepts

### `.ec-inject.yaml` — what it is and what it is not

The `.ec-inject.yaml` file is a **secret reference map** — it describes *where*
to find secrets, not the secrets themselves. It is safe to commit to source
control because it contains only backend identifiers, never values.

One file per External Credential, co-located with the
`.externalCredential-meta.xml` it references:

```
force-app/main/default/externalCredentials/
├── MyApiCred.externalCredential-meta.xml   ← deployed via sf project deploy
└── MyApiCred.ec-inject.yaml                ← read by sf secret inject
```

**File format:**

```yaml
credential: MyApiCred          # must match ExternalCredential DeveloperName exactly
principal: MyPrincipal         # must match Principal principalName exactly
protocol: oauth-client-credentials
secrets:
  clientId:                    # field name as Salesforce expects it (case-sensitive)
    source: system             # 'system' = OS keychain, 'env' = environment variable
    ref: MyApiCred.ClientID    # dot-separated reference key (safe for all backends)
  clientSecret:
    source: system
    ref: MyApiCred.ClientSecret
```

The `ref` value is the lookup key passed to the secret backend:
- For `source: system` — becomes the keychain account: `{orgAlias}.{ref}`
- For `source: env` — becomes an env var name: dots → underscores, uppercase (`MYAPICRED_CLIENTSECRET`)

**Field names by protocol** — must match Salesforce's OOTB credential field names exactly:

| Protocol | Field names |
|----------|-------------|
| `oauth-client-credentials` | `clientId`, `clientSecret` |
| `basic-auth` | `username`, `password` |

**What the plugin does NOT read from this file:** secret values, org connection
info, deployment targets. Those come from the SF CLI auth context (`--target-org`)
and the secret backend at runtime.

### Secret sources

| Source | How the secret is looked up | Scoping |
|--------|----------------------------|---------|
| `system` | OS keychain; service `sf-secret-inject`, account `{orgAlias}.{ref}` | Per-org (safe for multi-sandbox pipelines) |
| `env` | `process.env[ref.replace(/\./g,'_').toUpperCase()]` | Global to the process (CI-friendly) |

### Full deployment workflow

```
# Step 1 — deploy structure (Named Credential + External Credential + Permission Set)
sf project deploy start --source-dir force-app --target-org myOrg

# Step 2 — assign the permission set to the running user
sf org assign permset --name MyApiCred_Access --target-org myOrg

# Step 3 — inject secrets (requires Steps 1–2 to be complete)
sf secret inject --config force-app/main/default/externalCredentials/MyApiCred.ec-inject.yaml \
  --target-org myOrg
```

Step 3 will fail with NOT_FOUND if Step 1 has not been run, and the callout will
fail at runtime if Step 2 has been skipped. Steps 1 and 2 are idempotent and can
be re-run safely.

## Common workflows

### Store a secret locally (one-time setup per developer machine)

```
sf secret store --target-org myOrg --credential MyApiCred --field clientId
# prompts for the value securely; never echoes
```

Stored as: `myOrg.MyApiCred.ClientID` in the system keychain under service `sf-secret-inject`.

### Inject secrets into an org

```
sf secret inject --config force-app/main/default/externalCredentials/MyApiCred.ec-inject.yaml --target-org myOrg
```

For all `.ec-inject.yaml` files in a project:

```
sf secret inject --all --target-org myOrg
```

From environment variables (CI/CD pipelines):

```
sf secret inject --config MyApiCred.ec-inject.yaml --target-org myOrg --source env
```

### List External Credentials in an org

```
sf secret list --target-org myOrg
sf secret list --target-org myOrg --json
```

## CI/CD usage (env source)

Set env vars using the naming convention `{REF_UPPERCASE_WITH_UNDERSCORES}`:

```yaml
# GitHub Actions example
env:
  MYAPICRED_CLIENTID: ${{ secrets.MYAPICRED_CLIENTID }}
  MYAPICRED_CLIENTSECRET: ${{ secrets.MYAPICRED_CLIENTSECRET }}
```

Then inject with `--source env`:

```
sf secret inject --all --target-org $SF_ORG_ALIAS --source env
```

## Installation

```
sf plugins install sf-secret-inject
```

Or link a local checkout for development:

```
cd sf-secret-inject && npm install && npm run build && sf plugins link .
```

## Rules that always apply

1. Secret values are **never logged** to stdout or stderr — not by the plugin, not in `--json` output.
2. The `--source` flag overrides the `source` field for every entry in the YAML. Use `--source env` in CI where the system keychain is unavailable.
3. `sf secret inject` is idempotent — POST on first run, PUT on subsequent runs. Safe to re-run without side effects.
4. The `.ec-inject.yaml` file contains **only references** (backend + key), never secret values. It is safe to commit to source control.

## When *not* to use this plugin

- **Creating or updating the External Credential structure** (principals, protocol, permission sets). Use `sf project deploy` for that.
- **Retrieving secret values** from Salesforce — Salesforce does not return secret values via any API. This plugin is write-only.
- **OAuth token management or refresh.** Salesforce handles token lifecycle after secrets are injected.
