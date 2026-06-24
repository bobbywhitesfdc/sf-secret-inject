import {Flags, SfCommand} from '@salesforce/sf-plugins-core'

import type {ExternalCredential} from '../../lib/api.js'

import {listExternalCredentials} from '../../lib/api.js'

export default class SecretList extends SfCommand<ExternalCredential[]> {
  public static readonly description = `Queries the Tooling API for External Credential records and prints a table
showing each credential name, authentication protocol, principal names, and
per-principal authentication status.

Use --json for structured output suitable for scripting.`
public static readonly examples = [
    '<%= config.bin %> <%= command.id %> --target-org myOrg',
    '<%= config.bin %> <%= command.id %> --target-org myOrg --json',
  ]
public static readonly flags = {
    'target-org': Flags.requiredOrg({
      char: 'o',
      description: 'Alias or username of the org to query.',
    }),
  }
public static readonly summary =
    'List all External Credentials and their principals in the target org.'

  public async run(): Promise<ExternalCredential[]> {
    const {flags} = await this.parse(SecretList)

    const org = flags['target-org']
    const conn = org.getConnection()

    const credentials = await listExternalCredentials(conn)

    if (!this.jsonEnabled()) {
      if (credentials.length === 0) {
        this.log('No External Credentials found in this org.')
        return credentials
      }

      this.printTable(credentials)
    }

    return credentials
  }

  /**
   * Print a human-readable table of credentials and their principals.
   * Each principal occupies its own row; the credential name and protocol
   * are repeated per-row for readability in terminal output.
   */
  private printTable(credentials: ExternalCredential[]): void {
    const rows: TableRow[] = credentials.map((cred) => ({
      credential: cred.developerName,
      label: cred.masterLabel,
      protocol: cred.authenticationProtocol,
    }))

    this.table(
      {
        columns: [
          {key: 'credential', name: 'CREDENTIAL'},
          {key: 'label', name: 'LABEL'},
          {key: 'protocol', name: 'PROTOCOL'},
        ],
        data: rows,
      },
    )
  }
}

interface TableRow extends Record<string, unknown> {
  credential: string
  label: string
  protocol: string
}
