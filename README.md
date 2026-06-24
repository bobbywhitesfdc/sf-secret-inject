# sf-secret-inject

SF CLI plugin to securely inject secrets into Salesforce External Credential principals.

[![Version](https://img.shields.io/npm/v/sf-secret-inject.svg)](https://npmjs.org/package/sf-secret-inject)
[![License](https://img.shields.io/npm/l/sf-secret-inject.svg)](https://github.com/bobbywhitesfdc/sf-secret-inject/blob/main/LICENSE)

Salesforce strips secret values from all Metadata API payloads by design. This plugin provides the missing step: after `sf project deploy` creates your External Credential structure, `sf secret inject` pushes the actual secret values via the Named Credentials REST API.

## Prerequisites

Before injecting secrets, three things must exist in the target org:

1. **Named Credential** — the parent container that defines the callout endpoint
2. **External Credential + Principal** — defines the auth protocol and the identity that holds the secrets
3. **Permission Set** — grants users access to the External Credential principal

Deploy all three with `sf project deploy`, then assign the permission set:

```
sf project deploy start --source-dir force-app --target-org myOrg
sf org assign permset --name MyApiCred_Access --target-org myOrg
```

## Installation

```
sf plugins trust allowlist add -n sf-secret-inject
sf plugins install sf-secret-inject
```

## Claude Code skill

The plugin ships with a bundled [Claude Code](https://claude.ai/code) skill that lets Claude assist with the full injection workflow — generating `.ec-inject.yaml` files, troubleshooting prerequisite errors, and running `sf secret inject` on your behalf. The skill auto-triggers on phrases like "inject secrets into External Credential", "sf secret inject", or "External Credential principals".

```
sf secret install-skill
```

This copies `SKILL.md` to `~/.claude/skills/sf-secret-inject/`. Restart Claude Code to activate it.

Local dev contributors can symlink instead so edits show up live:

```
ln -sfn "$(pwd)/skill" ~/.claude/skills/sf-secret-inject
```

## The `.ec-inject.yaml` file

Each External Credential gets a config file co-located with its `.externalCredential-meta.xml`. It maps field names to secret references — never to secret values. It is safe to commit to source control.

**OAuth Client Credentials:**

```yaml
credential: MyApiCred          # ExternalCredential DeveloperName
principal: MyPrincipal         # Principal principalName
protocol: oauth-client-credentials
secrets:
  clientId:
    source: system             # 'system' = OS keychain, 'env' = environment variable
    ref: MyApiCred.ClientID    # lookup key passed to the backend
  clientSecret:
    source: system
    ref: MyApiCred.ClientSecret
```

**Basic Auth:**

```yaml
credential: MyBasicCred
principal: MyPrincipal
protocol: basic-auth
secrets:
  username:
    source: env
    ref: MyBasicCred.Username  # resolves to env var MYBASICCRED_USERNAME
  password:
    source: env
    ref: MyBasicCred.Password
```

**Field names by protocol:**

| Protocol | Field names |
|----------|-------------|
| `oauth-client-credentials` | `clientId`, `clientSecret` |
| `basic-auth` | `username`, `password` |

## Usage

### Store a secret locally (one-time per machine)

```
sf secret store --credential MyApiCred --field clientId --target-org myOrg
```

Prompts for the value with hidden input. Stored in the OS keychain under service `sf-secret-inject`, account `myOrg.MyApiCred.clientId`.

### Inject secrets into an org

```
sf secret inject --config force-app/main/default/externalCredentials/MyApiCred.ec-inject.yaml --target-org myOrg
```

Inject all `.ec-inject.yaml` files found under the current directory:

```
sf secret inject --all --target-org myOrg
```

### List External Credentials in an org

```
sf secret list --target-org myOrg
```

## Secret backends

| Source | How secrets are resolved | Best for |
|--------|--------------------------|----------|
| `system` | OS keychain scoped to `{orgAlias}.{ref}` | Local development; multiple sandbox environments on one machine |
| `env` | Environment variable — `ref` uppercased with dots replaced by underscores | CI/CD pipelines |

The `--source` flag overrides the `source` field for all entries in the YAML file.

## CI/CD usage

Store secrets as CI environment variables using the naming convention `{REF_UPPERCASE_WITH_UNDERSCORES}`:

```yaml
# GitHub Actions
env:
  MYAPICRED_CLIENTID: ${{ secrets.MYAPICRED_CLIENTID }}
  MYAPICRED_CLIENTSECRET: ${{ secrets.MYAPICRED_CLIENTSECRET }}
```

Then inject with `--source env`:

```
sf secret inject --all --target-org $SF_ORG_ALIAS --source env
```

## Full deployment workflow

```
# 1. Deploy structure
sf project deploy start --source-dir force-app --target-org myOrg

# 2. Assign the permission set
sf org assign permset --name MyApiCred_Access --target-org myOrg

# 3. Inject secrets
sf secret inject --config force-app/main/default/externalCredentials/MyApiCred.ec-inject.yaml --target-org myOrg
```

## Commands

<!-- commands -->
<!-- commandsstop -->

## Security notes

- Secret values are **never** logged to stdout or stderr
- The `.ec-inject.yaml` file contains only lookup references, never secret values — it is safe to commit
- The `system` backend scopes keys per org alias, so secrets for different sandboxes never collide on a shared machine
- `sf secret inject` is idempotent — POST on first run, PUT on subsequent runs
