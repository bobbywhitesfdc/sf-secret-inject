/**
 * Describes which fields belong to each authentication protocol, and which
 * of those fields carry sensitive values that must never be logged.
 */
export interface ProtocolDescriptor {
  /** Subset of fields whose values are encrypted/sensitive */
  encryptedFields: readonly string[]
  /** All field names for this protocol */
  fields: readonly string[]
}

/**
 * Canonical field definitions for each supported authentication protocol.
 *
 * These mirror the Salesforce External Credential Named Principal field names
 * as documented in the Metadata API reference. The plugin uses this map to
 * validate YAML configs and to build the correct request payload.
 */
export const PROTOCOL_FIELDS: Record<string, ProtocolDescriptor> = {
  'aws-signature-v4': {
    encryptedFields: ['awsSecretAccessKey'],
    fields: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  // AWS STS Roles Anywhere does not require a user-supplied secret; the
  // roleArn is metadata, not a runtime credential.
  'aws-sts-roles-anywhere': {
    encryptedFields: [],
    fields: ['awsRoleArn'],
  },
  'basic-auth': {
    encryptedFields: ['password'],
    fields: ['username', 'password'],
  },
  // Custom protocols support arbitrary name/value pairs. Validation is
  // left to the caller — any field name is accepted.
  custom: {
    encryptedFields: [],
    fields: [],
  },
  'oauth-client-credentials': {
    encryptedFields: ['clientSecret'],
    fields: ['clientId', 'clientSecret'],
  },
}

/**
 * Return true if the given field name is encrypted for the given protocol.
 * If the protocol is unknown, defaults to false (no masking) so the plugin
 * does not silently drop output for unrecognised protocols.
 */
export function isEncryptedField(protocol: string, fieldName: string): boolean {
  return PROTOCOL_FIELDS[protocol]?.encryptedFields.includes(fieldName) ?? false
}
