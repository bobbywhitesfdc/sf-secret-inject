import type {Connection} from '@salesforce/core'

import type {EcInjectConfig} from './yaml.js'

/** API version used for all Named Credentials REST calls */
const API_VERSION = 'v67.0'

// ── Request / Response shapes ────────────────────────────────────────────────

/**
 * The response body returned by the Named Credentials credential endpoint
 * after a successful POST or PUT.
 */
export interface CredentialResponse {
  [key: string]: unknown
  /** Echoed back from the request */
  credentialName?: string
  /** Incremented on each successful upsert */
  revision?: number
}

/**
 * A single External Credential record as returned by the Tooling API.
 */
export interface ExternalCredential {
  authenticationProtocol: string
  developerName: string
  masterLabel: string
  principals: ExternalCredentialPrincipal[]
}

/**
 * A principal within an External Credential.
 */
export interface ExternalCredentialPrincipal {
  authenticationStatus: string
  principalName: string
}

// ── API error shape ───────────────────────────────────────────────────────────

interface SalesforceApiError {
  errorCode?: string
  message?: string
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Inject secrets into a Named Credential principal.
 *
 * The Named Credentials REST API requires a POST for first-time creation.
 * If the server responds with a CONFLICT error code (principal already exists),
 * we retry with a PUT to update the existing record.
 *
 * Secret values are passed in from `resolvedSecrets` and never constructed
 * from user-controlled concatenation to prevent injection.
 *
 * @param conn            An authenticated @salesforce/core Connection
 * @param config          Parsed .ec-inject.yaml configuration
 * @param resolvedSecrets Map of field name → plaintext secret value
 */
export async function injectCredential(
  conn: Connection,
  config: EcInjectConfig,
  resolvedSecrets: Record<string, string>,
): Promise<CredentialResponse> {
  const path = `/services/data/${API_VERSION}/named-credentials/credential/`
  const body = buildRequestBody(config, resolvedSecrets)

  try {
    const response = await conn.request<CredentialResponse>({
      body: JSON.stringify(body),
      headers: {'Content-Type': 'application/json'},
      method: 'POST',
      url: path,
    })
    return response
  } catch (error) {
    const apiErr = extractApiError(error)

    if (apiErr?.errorCode === 'CONFLICT') {
      // Principal already exists — update it via PUT to the same endpoint.
      const response = await conn.request<CredentialResponse>({
        body: JSON.stringify(body),
        headers: {'Content-Type': 'application/json'},
        method: 'PUT',
        url: path,
      })
      return response
    }

    // Re-throw anything that is not a CONFLICT.
    throw error
  }
}

/**
 * Fetch all External Credentials visible to the authenticated user.
 *
 * Uses the Tooling API to query ExternalCredential and its related
 * NamedCredentialExternalCredentialPrincipal records in a single request.
 */
export async function listExternalCredentials(conn: Connection): Promise<ExternalCredential[]> {
  // The Tooling API soql endpoint supports subqueries via the tooling property.
  const soql =
    'SELECT DeveloperName, MasterLabel, AuthenticationProtocol, ' +
    '(SELECT PrincipalName, AuthenticationStatus FROM NamedCredentialExternalCredentialPrincipals) ' +
    'FROM ExternalCredential ORDER BY DeveloperName ASC'

  const result = await conn.tooling.query<ToolingExternalCredentialRecord>(soql)

  return result.records.map((record) => ({
    authenticationProtocol: record.AuthenticationProtocol,
    developerName: record.DeveloperName,
    masterLabel: record.MasterLabel,
    principals: (record.NamedCredentialExternalCredentialPrincipals?.records ?? []).map((p) => ({
      authenticationStatus: p.AuthenticationStatus,
      principalName: p.PrincipalName,
    })),
  }))
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build the JSON payload for the Named Credentials credential endpoint.
 *
 * Confirmed shape (verified 2026-06-23 against myOrg sandbox):
 *   POST/PUT /services/data/vXX/named-credentials/credential/
 *   {
 *     externalCredential: "DeveloperName",
 *     principalName: "PrincipalName",
 *     principalType: "NamedPrincipal",
 *     credentials: {
 *       clientId: { value: "...", encrypted: false },
 *       clientSecret: { value: "...", encrypted: true }
 *     }
 *   }
 */
function buildRequestBody(
  config: EcInjectConfig,
  resolvedSecrets: Record<string, string>,
): Record<string, unknown> {
  const credentials: Record<string, {encrypted: boolean; value: string;}> = {}
  for (const [fieldName, value] of Object.entries(resolvedSecrets)) {
    credentials[fieldName] = {
      encrypted:
        fieldName.toLowerCase().includes('secret') || fieldName.toLowerCase().includes('password'),
      value,
    }
  }

  return {
    credentials,
    externalCredential: config.credential,
    principalName: config.principal,
    principalType: 'NamedPrincipal',
  }
}

/**
 * Attempt to extract a structured Salesforce API error from an unknown thrown
 * value. Returns undefined if the error does not match the expected shape.
 */
function extractApiError(err: unknown): SalesforceApiError | undefined {
  if (err === null || typeof err !== 'object') return undefined

  const candidate = err as Record<string, unknown>

  // @salesforce/core wraps API errors; the raw body is usually in `data` or
  // the error itself may carry `errorCode`.
  if (typeof candidate.errorCode === 'string') {
    return {errorCode: candidate.errorCode, message: candidate.message as string | undefined}
  }

  // Sometimes the error embeds an array of error objects in `data`.
  const {data} = candidate
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown>
    if (typeof first.errorCode === 'string') {
      return {errorCode: first.errorCode, message: first.message as string | undefined}
    }
  }

  return undefined
}

// ── Tooling API record shapes ─────────────────────────────────────────────────

interface ToolingExternalCredentialRecord {
  AuthenticationProtocol: string
  DeveloperName: string
  MasterLabel: string
  NamedCredentialExternalCredentialPrincipals?: {
    records: Array<{
      AuthenticationStatus: string
      PrincipalName: string
    }>
  }
}
